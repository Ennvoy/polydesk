// EditorGroup（F-4）：Monaco 多 tab 編輯 + 編碼/EOL 狀態列 + 分割並排 + Ctrl+S 存檔
// + 外部修改衝突處理（REQ-EDIT-001/002/006/007/008/009、REQ-PERF-003、REQ-E2E-002/009）。
// 註：本元件由 panelRegistry 掛載於 dockview 'editor' 槽（見 ./index.ts）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { ipc } from '../../ipc/client';
import { editorBus, type OpenFileRequest } from '../../state/editorBus';
import { dialog } from '../Dialogs/host';
import { useTheme } from '../../theme/ThemeProvider';
import { mark, measure } from '../../../shared/perf';
import type { FileEncoding, Eol } from '../../../shared/types';
import type { InvokeRes } from '../../../shared/ipc';
import { tabKey, modelUri, baseName, langFromPath, monoFontFamily, applyMonacoTheme } from './models';

interface Tab {
  key: string;
  wsId: string;
  path: string;
  name: string;
  language: string;
  encoding: FileEncoding;
  eol: Eol;
  readonly: boolean;
  dirty: boolean;
}

const SELF_WRITE_ECHO_MS = 1500;

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  multiCursorModifier: 'ctrlCmd',
  renderWhitespace: 'selection',
  tabSize: 2,
};

/** 一次性錯誤彈窗（單一「關閉」鈕）。 */
function showError(title: string, body: string): void {
  void dialog.open((close) => (
    <div style={{ minWidth: 320, maxWidth: 460 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>{title}</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{body}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn pd-btn-primary" onClick={() => close()} aria-label="關閉">
          關閉
        </button>
      </div>
    </div>
  ));
}

/** 外部修改 + 本地有未存編輯時的抉擇彈窗。 */
function ExternalChangePrompt(props: { name: string; onReload: () => void; onKeep: () => void }): React.JSX.Element {
  return (
    <div style={{ minWidth: 360, maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>檔案已在磁碟上被修改</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        「{props.name}」在外部被更動，而你有尚未存檔的編輯。要載入磁碟上的新版本（丟棄你的編輯），還是保留你的編輯？
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={props.onKeep} aria-label="保留我的編輯">
          保留我的編輯
        </button>
        <button className="pd-btn pd-btn-primary" onClick={props.onReload} aria-label="載入磁碟版本">
          載入磁碟版本
        </button>
      </div>
    </div>
  );
}

export function EditorGroup(): React.JSX.Element {
  const { theme } = useTheme();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // DOM 容器
  const primaryElRef = useRef<HTMLDivElement | null>(null);
  const secondaryElRef = useRef<HTMLDivElement | null>(null);
  // Monaco 實例
  const primaryEdRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const secondaryEdRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // 同步給事件回呼用的最新值（避免 stale closure）
  const tabsRef = useRef<Tab[]>(tabs);
  const activeKeyRef = useRef<string | null>(activeKey);
  // model content 監聽 / 程式化更新抑制 / 自寫回音抑制 / 待捲動行
  const listenersRef = useRef<Map<string, monaco.IDisposable>>(new Map());
  const suppressDirtyRef = useRef<Set<string>>(new Set());
  const selfWriteRef = useRef<Map<string, number>>(new Map());
  const pendingRevealRef = useRef<number | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const active = tabs.find((t) => t.key === activeKey) ?? null;

  // ── 重載磁碟版本（程式化 setValue，抑制 dirty 標記） ──
  const reload = useCallback(async (key: string, wsId: string, path: string) => {
    let r: InvokeRes<'fs:read'>;
    try {
      r = await ipc.fs.read({ wsId, path });
    } catch {
      return;
    }
    const model = monaco.editor.getModel(modelUri(wsId, path));
    if (!model) return;
    suppressDirtyRef.current.add(key);
    model.setValue(r.content);
    suppressDirtyRef.current.delete(key);
    setTabs((prev) =>
      prev.map((t) => (t.key === key ? { ...t, encoding: r.encoding, eol: r.eol, readonly: r.readonly, dirty: false } : t)),
    );
  }, []);

  // ── 開檔（editorBus 入口） ──
  const openFile = useCallback(async (req: OpenFileRequest) => {
    const key = tabKey(req.wsId, req.path);

    if (tabsRef.current.some((t) => t.key === key)) {
      setActiveKey(key);
      if (req.split) setSplit(true);
      if (req.line) pendingRevealRef.current = req.line;
      return;
    }

    const startMark = `fileOpen:${key}:${Date.now()}`;
    mark(startMark);

    let r: InvokeRes<'fs:read'>;
    try {
      r = await ipc.fs.read({ wsId: req.wsId, path: req.path });
    } catch (e) {
      showError('無法開啟檔案', e instanceof Error ? e.message : String(e));
      return;
    }

    const uri = modelUri(req.wsId, req.path);
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(r.content, langFromPath(req.path), uri);
    const language = model.getLanguageId();

    if (!listenersRef.current.has(key)) {
      const d = model.onDidChangeContent(() => {
        if (suppressDirtyRef.current.has(key)) return;
        setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, dirty: true } : t)));
      });
      listenersRef.current.set(key, d);
    }

    const tab: Tab = {
      key,
      wsId: req.wsId,
      path: req.path,
      name: baseName(req.path),
      language,
      encoding: r.encoding,
      eol: r.eol,
      readonly: r.readonly,
      dirty: false,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveKey(key);
    if (req.split) setSplit(true);
    if (req.line) pendingRevealRef.current = req.line;
    measure('fileOpen', startMark); // REQ-PERF-003：開檔到首屏
  }, []);

  // ── 存檔（Ctrl+S） ──
  const saveActive = useCallback(async () => {
    const key = activeKeyRef.current;
    if (!key) return;
    const tab = tabsRef.current.find((t) => t.key === key);
    if (!tab) return;
    const model = monaco.editor.getModel(modelUri(tab.wsId, tab.path));
    if (!model) return;

    let res: InvokeRes<'fs:write'>;
    try {
      res = await ipc.fs.write({ wsId: tab.wsId, path: tab.path, content: model.getValue(), encoding: tab.encoding, eol: tab.eol });
    } catch (e) {
      showError('存檔失敗', e instanceof Error ? e.message : String(e));
      return;
    }

    if ('ok' in res) {
      selfWriteRef.current.set(key, Date.now());
      setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, dirty: false } : t)));
      return;
    }
    if (res.error === 'permission') {
      showError('無法存檔', '檔案為唯讀或權限不足，無法寫入。');
      return;
    }
    // conflict：磁碟版本較新 → 讓使用者選載入或覆蓋（不靜默蓋掉外部版本）。
    const choice = await dialog.open((close) => (
      <ExternalChangePrompt name={tab.name} onReload={() => close('reload')} onKeep={() => close('overwrite')} />
    ));
    if (choice === 'reload') {
      await reload(key, tab.wsId, tab.path);
      return;
    }
    // overwrite：先重讀刷新 main 的版本指紋（內容不套用、保留我的編輯），再寫回。
    try {
      await ipc.fs.read({ wsId: tab.wsId, path: tab.path });
    } catch {
      /* ignore */
    }
    let res2: InvokeRes<'fs:write'>;
    try {
      res2 = await ipc.fs.write({ wsId: tab.wsId, path: tab.path, content: model.getValue(), encoding: tab.encoding, eol: tab.eol });
    } catch (e) {
      showError('存檔失敗', e instanceof Error ? e.message : String(e));
      return;
    }
    if ('ok' in res2) {
      selfWriteRef.current.set(key, Date.now());
      setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, dirty: false } : t)));
    } else {
      showError('無法存檔', res2.error === 'permission' ? '檔案為唯讀或權限不足。' : '存檔再次發生衝突。');
    }
  }, [reload]);

  // ── 關閉 tab（dirty 先確認） ──
  const closeTab = useCallback((key: string) => {
    const tab = tabsRef.current.find((t) => t.key === key);
    const d = listenersRef.current.get(key);
    if (d) {
      d.dispose();
      listenersRef.current.delete(key);
    }
    if (tab) monaco.editor.getModel(modelUri(tab.wsId, tab.path))?.dispose();
    const remaining = tabsRef.current.filter((t) => t.key !== key);
    setTabs(remaining);
    setActiveKey((prev) => (prev === key ? (remaining.length ? remaining[remaining.length - 1].key : null) : prev));
  }, []);

  const requestClose = useCallback(
    async (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (tab?.dirty) {
        const ok = await dialog.confirm({
          title: '尚未存檔',
          body: `「${tab.name}」有未存檔的變更，確定關閉？`,
          confirmText: '關閉不存',
          cancelText: '取消',
          danger: true,
        });
        if (!ok) return;
      }
      closeTab(key);
    },
    [closeTab],
  );

  // ── 建立主編輯器（一次） ──
  useEffect(() => {
    if (!primaryElRef.current) return;
    applyMonacoTheme(theme);
    const ed = monaco.editor.create(primaryElRef.current, { ...EDITOR_OPTIONS, fontFamily: monoFontFamily() });
    primaryEdRef.current = ed;
    const d = ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, col: e.position.column }));
    return () => {
      d.dispose();
      ed.dispose();
      primaryEdRef.current = null;
    };
    // 主題切換另由下方 effect 處理；此處僅建立一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 主題切換 ──
  useEffect(() => {
    applyMonacoTheme(theme);
  }, [theme]);

  // ── 綁定 active model 到主編輯器（含待捲動行） ──
  useEffect(() => {
    const ed = primaryEdRef.current;
    if (!ed) return;
    if (!active) {
      if (ed.getModel()) ed.setModel(null);
      return;
    }
    const model = monaco.editor.getModel(modelUri(active.wsId, active.path));
    if (ed.getModel() !== model) ed.setModel(model ?? null); // 避免 dirty 變動觸發無謂 setModel（重置游標）
    ed.updateOptions({ readOnly: active.readonly });
    if (model && pendingRevealRef.current) {
      const line = pendingRevealRef.current;
      pendingRevealRef.current = null;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }
  }, [active]);

  // ── 分割並排：建立/銷毀次編輯器並綁同一 model（共享 dirty，REQ-EDIT-006） ──
  useEffect(() => {
    if (!split) {
      if (secondaryEdRef.current) {
        secondaryEdRef.current.dispose();
        secondaryEdRef.current = null;
      }
      return;
    }
    if (!secondaryElRef.current) return;
    const ed = monaco.editor.create(secondaryElRef.current, { ...EDITOR_OPTIONS, fontFamily: monoFontFamily() });
    secondaryEdRef.current = ed;
    return () => {
      ed.dispose();
      secondaryEdRef.current = null;
    };
  }, [split]);

  // 次編輯器跟隨 active model
  useEffect(() => {
    const ed = secondaryEdRef.current;
    if (!ed) return;
    const model = active ? monaco.editor.getModel(modelUri(active.wsId, active.path)) : null;
    if (ed.getModel() !== model) ed.setModel(model ?? null);
    ed.updateOptions({ readOnly: active?.readonly ?? false });
  }, [active, split]);

  // ── editorBus 訂閱 ──
  useEffect(() => {
    return editorBus.subscribe((req) => void openFile(req));
  }, [openFile]);

  // ── 外部修改事件（F-2 watcher 發 fs:change） ──
  useEffect(() => {
    return ipc.events.fs.change(({ wsId, path, kind }) => {
      const key = tabKey(wsId, path);
      if (!tabsRef.current.some((t) => t.key === key)) return;
      if (kind === 'unlink') return; // 檔案被刪：保留編輯內容、不動作（使用者可另存）
      // 抑制本程式剛寫入造成的回音事件，避免自我重載迴圈
      if (Date.now() - (selfWriteRef.current.get(key) ?? 0) < SELF_WRITE_ECHO_MS) return;
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) return;
      if (!tab.dirty) {
        void reload(key, wsId, path); // 無未存編輯：自動重載
        return;
      }
      void dialog
        .open((close) => (
          <ExternalChangePrompt name={tab.name} onReload={() => close('reload')} onKeep={() => close('keep')} />
        ))
        .then((choice) => {
          if (choice === 'reload') void reload(key, wsId, path);
        });
    });
  }, [reload]);

  // ── Ctrl/Cmd+S 存檔 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        if (!activeKeyRef.current) return;
        e.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive]);

  // ── 卸載時清掉所有 model 監聽 ──
  useEffect(() => {
    const listeners = listenersRef.current;
    return () => {
      for (const d of listeners.values()) d.dispose();
      listeners.clear();
    };
  }, []);

  return (
    <div className="pd-editor-root">
      <div className="pd-editor-tabs" role="tablist" aria-label="開啟的檔案">
        {tabs.map((t) => (
          <div
            key={t.key}
            role="tab"
            tabIndex={0}
            aria-selected={t.key === activeKey}
            aria-label={`${t.name}${t.dirty ? '（未存檔）' : ''}`}
            className={`pd-editor-tab${t.key === activeKey ? ' is-active' : ''}`}
            title={t.path}
            onMouseDown={() => setActiveKey(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveKey(t.key);
              }
            }}
          >
            <span className="pd-editor-tab-name">{t.name}</span>
            {t.dirty && <span className="pd-editor-dot" aria-hidden="true" />}
            <button
              className="pd-editor-tab-close"
              aria-label={`關閉 ${t.name}`}
              title="關閉"
              onClick={(e) => {
                e.stopPropagation();
                void requestClose(t.key);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="pd-editor-tabs-spacer" />
        <button
          className="pd-editor-action"
          aria-label={split ? '取消分割並排' : '分割並排'}
          aria-pressed={split}
          title={split ? '取消分割並排' : '分割並排'}
          disabled={!activeKey}
          onClick={() => setSplit((s) => !s)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="1.5" />
            <path d="M12 4v16" />
          </svg>
        </button>
      </div>

      <div className="pd-editor-panes">
        <div ref={primaryElRef} className="pd-editor-pane" aria-label="編輯區" />
        {split && <div ref={secondaryElRef} className="pd-editor-pane pd-editor-pane-split" aria-label="分割編輯區" />}
        {tabs.length === 0 && (
          <div className="pd-editor-empty" aria-hidden="true">
            <p>尚未開啟檔案</p>
            <p className="pd-editor-empty-sub">從左側檔案總管點檔開啟 · Ctrl+S 存檔</p>
          </div>
        )}
      </div>

      <div className="pd-editor-status" aria-label="編輯器狀態列">
        {active ? (
          <>
            <span>{active.language}</span>
            <span className="pd-editor-status-sep">·</span>
            <span>{active.encoding}</span>
            <span className="pd-editor-status-sep">·</span>
            <span>{active.eol.toUpperCase()}</span>
            {active.readonly && (
              <>
                <span className="pd-editor-status-sep">·</span>
                <span className="pd-editor-ro">唯讀</span>
              </>
            )}
            <span className="pd-editor-status-right">
              行 {cursor.line}，欄 {cursor.col}
            </span>
          </>
        ) : (
          <span className="pd-editor-status-idle">就緒</span>
        )}
      </div>
    </div>
  );
}
