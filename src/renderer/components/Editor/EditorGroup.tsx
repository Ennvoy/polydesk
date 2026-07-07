// EditorGroup（F-4）：Monaco 多 tab 編輯 + 編碼/EOL 狀態列 + 分割並排 + Ctrl+S 存檔
// + 外部修改衝突處理（REQ-EDIT-001/002/006/007/008/009、REQ-PERF-003、REQ-E2E-002/009）。
// 註：本元件由 panelRegistry 掛載於 dockview 'editor' 槽（見 ./index.ts）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { editorBus, type OpenFileRequest, type OpenDiffRequest } from '../../state/editorBus';
import { DiffView } from '../SourceControl/DiffView';
import { dialog } from '../Dialogs/host';
import { useTheme } from '../../theme/ThemeProvider';
import { mark, measure } from '../../../shared/perf';
import type { FileEncoding, Eol } from '../../../shared/types';
import type { InvokeRes } from '../../../shared/ipc';
import { tabKey, modelUri, baseName, langFromPath, monoFontFamily, applyMonacoTheme } from './models';
import { SheetView } from './SheetView';
import { DocView } from './DocView';
import { ImageView } from './ImageView';

interface Tab {
  key: string;
  wsId: string;
  path: string;
  name: string;
  /** 'file'=可編輯檔；'diff'=唯讀差異檢視（SCM 點變更檔）；'sheet'=xlsx/xls 唯讀表格預覽。 */
  kind: 'file' | 'diff' | 'sheet' | 'doc' | 'image';
  language: string;
  encoding: FileEncoding;
  eol: Eol;
  readonly: boolean;
  dirty: boolean;
  /** 外部（codex/claude 等）改過磁碟、但本地有未存編輯 → 只標記不打斷，關檔時再提醒。 */
  diskChanged?: boolean;
  /** diff 分頁的 unified diff 內容（kind==='diff'）。 */
  patch?: string;
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

/** 關閉未存檔分頁時的抉擇（儲存 / 不儲存 / 取消）；diskChanged 時附「磁碟版本不同」提示。 */
function SaveOnClosePrompt(props: { name: string; note: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }): React.JSX.Element {
  return (
    <div style={{ minWidth: 360, maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>尚未存檔</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        「{props.name}」有未存檔的變更。{props.note}要儲存嗎？
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={props.onCancel} aria-label="取消">
          取消
        </button>
        <button className="pd-btn pd-btn-danger" onClick={props.onDiscard} aria-label="不儲存並關閉">
          不儲存
        </button>
        <button className="pd-btn pd-btn-primary" onClick={props.onSave} aria-label="儲存並關閉" autoFocus>
          儲存
        </button>
      </div>
    </div>
  );
}

export function EditorGroup(): React.JSX.Element {
  const { theme } = useTheme();
  const { activeWorkspaceId } = useAppState();
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
  const pendingRevealRef = useRef<{ line: number; col: number; len: number } | null>(null);
  const lastFocusKeyRef = useRef<string | null>(null); // 上次因開檔/切分頁聚焦過的 key（避免背景 metadata 變動搶焦點）

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  // 分頁依工作區分離：分頁列只列當前工作區的分頁（其餘保持開啟但隱藏，切回即還原）。
  const visibleTabs = tabs.filter((t) => t.wsId === activeWorkspaceId);
  const lastActivePerWsRef = useRef<Map<string, string>>(new Map());

  // 記住每個工作區最後聚焦的分頁（切回工作區時還原）
  useEffect(() => {
    if (!activeKey) return;
    const t = tabsRef.current.find((x) => x.key === activeKey);
    if (t) lastActivePerWsRef.current.set(t.wsId, activeKey);
  }, [activeKey]);

  // 工作區切換：聚焦切到該工作區記住的分頁（或第一個）；該工作區沒分頁則清空編輯區
  useEffect(() => {
    if (!activeWorkspaceId) return;
    const cur = tabsRef.current.find((x) => x.key === activeKeyRef.current);
    if (cur && cur.wsId === activeWorkspaceId) return; // 已聚焦在此工作區的分頁
    const list = tabsRef.current.filter((x) => x.wsId === activeWorkspaceId);
    const remembered = lastActivePerWsRef.current.get(activeWorkspaceId);
    setActiveKey(remembered && list.some((x) => x.key === remembered) ? remembered : (list[0]?.key ?? null));
  }, [activeWorkspaceId]);

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
      if (req.line) pendingRevealRef.current = { line: req.line, col: req.col ?? 1, len: req.selectLen ?? 0 };
      return;
    }

    // 試算表（xlsx/xls）→ 唯讀表格預覽，不進 Monaco（避免二進位亂碼）
    if (/\.(xlsx|xls|xlsm|xlsb)$/i.test(req.path)) {
      setTabs((prev) => [
        ...prev,
        { key, wsId: req.wsId, path: req.path, name: baseName(req.path), kind: 'sheet', language: 'xlsx', encoding: 'utf-8', eol: 'lf', readonly: true, dirty: false },
      ]);
      setActiveKey(key);
      return;
    }

    // 圖片 → 唯讀圖片預覽，不進 Monaco（避免二進位亂碼）
    if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(req.path)) {
      setTabs((prev) => [
        ...prev,
        { key, wsId: req.wsId, path: req.path, name: baseName(req.path), kind: 'image', language: 'image', encoding: 'utf-8', eol: 'lf', readonly: true, dirty: false },
      ]);
      setActiveKey(key);
      return;
    }

    // Word 文件（docx/docm/doc）→ 唯讀文件預覽（mammoth HTML／doc 純文字），不進 Monaco
    if (/\.(docx|docm|doc)$/i.test(req.path)) {
      setTabs((prev) => [
        ...prev,
        { key, wsId: req.wsId, path: req.path, name: baseName(req.path), kind: 'doc', language: 'word', encoding: 'utf-8', eol: 'lf', readonly: true, dirty: false },
      ]);
      setActiveKey(key);
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
      kind: 'file',
      language,
      encoding: r.encoding,
      eol: r.eol,
      readonly: r.readonly,
      dirty: false,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveKey(key);
    if (req.split) setSplit(true);
    if (req.line) pendingRevealRef.current = { line: req.line, col: req.col ?? 1, len: req.selectLen ?? 0 };
    measure('fileOpen', startMark); // REQ-PERF-003：開檔到首屏
  }, []);

  // ── 開差異分頁（SCM 點變更檔；工作樹 vs HEAD，唯讀 Monaco diff）──
  const openDiff = useCallback(async (req: OpenDiffRequest) => {
    const key = req.commit
      ? `diff::commit::${req.wsId}::${req.commit}::${req.commitPath ?? ''}`
      : `diff::${tabKey(req.wsId, req.path)}::${req.staged ? 'staged' : 'unstaged'}`;
    if (tabsRef.current.some((t) => t.key === key)) {
      setActiveKey(key);
      return;
    }
    let patch = '';
    try {
      patch = req.commit
        ? (await ipc.git.show({ wsId: req.wsId, ref: req.commit, path: req.commitPath })).patch
        : (await ipc.git.diff({ wsId: req.wsId, path: req.path, staged: req.staged })).patch;
    } catch (e) {
      showError('無法載入差異', e instanceof Error ? e.message : String(e));
      return;
    }
    const tab: Tab = {
      key,
      wsId: req.wsId,
      path: req.path,
      name: req.commit
        ? req.commitPath
          ? `${baseName(req.commitPath)} @ ${req.commit.slice(0, 7)}`
          : `commit ${req.commit.slice(0, 7)} 變更`
        : `${baseName(req.path)}${req.staged ? '（已暫存差異）' : '（差異）'}`,
      kind: 'diff',
      language: langFromPath(req.commitPath ?? req.path),
      encoding: 'utf-8', // placeholder：diff 分頁唯讀、不存檔（saveActive 已 guard）
      eol: 'lf',
      readonly: true,
      dirty: false,
      patch,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveKey(key);
  }, []);

  // ── 存檔（回 true=已存檔並寫回磁碟；供 Ctrl+S 與關檔前儲存共用） ──
  const saveTab = useCallback(
    async (key: string): Promise<boolean> => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab || tab.kind !== 'file') return false; // diff/sheet 分頁唯讀、不可存
      const model = monaco.editor.getModel(modelUri(tab.wsId, tab.path));
      if (!model) return false;

      let res: InvokeRes<'fs:write'>;
      try {
        res = await ipc.fs.write({ wsId: tab.wsId, path: tab.path, content: model.getValue(), encoding: tab.encoding, eol: tab.eol });
      } catch (e) {
        showError('存檔失敗', e instanceof Error ? e.message : String(e));
        return false;
      }

      if ('ok' in res) {
        selfWriteRef.current.set(key, Date.now());
        setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, dirty: false, diskChanged: false } : t)));
        return true;
      }
      if (res.error === 'permission') {
        showError('無法存檔', '檔案為唯讀或權限不足，無法寫入。');
        return false;
      }
      // conflict：磁碟版本較新 → 讓使用者選載入或覆蓋（不靜默蓋掉外部版本）。
      const choice = await dialog.open((close) => (
        <ExternalChangePrompt name={tab.name} onReload={() => close('reload')} onKeep={() => close('overwrite')} />
      ));
      if (choice === 'reload') {
        await reload(key, tab.wsId, tab.path);
        return false; // 載入磁碟版本＝放棄本地編輯，視為「未存我的編輯」
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
        return false;
      }
      if ('ok' in res2) {
        selfWriteRef.current.set(key, Date.now());
        setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, dirty: false, diskChanged: false } : t)));
        return true;
      }
      showError('無法存檔', res2.error === 'permission' ? '檔案為唯讀或權限不足。' : '存檔再次發生衝突。');
      return false;
    },
    [reload],
  );

  const saveActive = useCallback(() => {
    const key = activeKeyRef.current;
    if (key) void saveTab(key);
  }, [saveTab]);

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
    // 遞補只在同一工作區內找（分頁依工作區分離，不跳到別的工作區的分頁）
    const sameWs = tab ? remaining.filter((t) => t.wsId === tab.wsId) : remaining;
    setActiveKey((prev) => (prev === key ? (sameWs.length ? sameWs[sameWs.length - 1].key : null) : prev));
  }, []);

  const requestClose = useCallback(
    async (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (tab?.dirty) {
        const note = tab.diskChanged ? '此檔在外部也被改過（磁碟版本與你的編輯不同）。' : '';
        const choice = await dialog.open((close) => (
          <SaveOnClosePrompt
            name={tab.name}
            note={note}
            onSave={() => close('save')}
            onDiscard={() => close('discard')}
            onCancel={() => close('cancel')}
          />
        ));
        if (choice === 'save') {
          if (!(await saveTab(key))) return; // 存檔失敗/衝突未解 → 不關
        } else if (choice !== 'discard') {
          return; // 取消 / 點外關閉
        }
      }
      closeTab(key);
    },
    [closeTab, saveTab],
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
    if (active.kind === 'diff') {
      if (ed.getModel()) ed.setModel(null); // diff 分頁不綁檔 model（改由 DiffView 渲染）
      lastFocusKeyRef.current = activeKey;
      return;
    }
    const model = monaco.editor.getModel(modelUri(active.wsId, active.path));
    if (ed.getModel() !== model) ed.setModel(model ?? null); // 避免 dirty 變動觸發無謂 setModel（重置游標）
    ed.updateOptions({ readOnly: active.readonly });
    if (model && pendingRevealRef.current) {
      const { line, col, len } = pendingRevealRef.current;
      pendingRevealRef.current = null;
      if (len > 0) {
        // 搜尋命中：反白選取命中片段並置中（selection 即 highlight）
        ed.setSelection({ startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col + len });
        ed.revealRangeInCenter({ startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col + len });
      } else {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: col });
      }
      ed.focus();
    } else if (model && lastFocusKeyRef.current !== activeKey) {
      // 開檔 / 切分頁（active key 變更）後聚焦編輯器：鍵盤可直接編輯（REQ-UI-004 / 開檔即可打字）。
      // 僅 key 變更才 focus，避免背景 metadata（dirty/readonly）變動搶走他處焦點。
      ed.focus();
    }
    lastFocusKeyRef.current = activeKey;
  }, [active, activeKey]);

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

  // ── editorBus 訂閱（開檔 + 開差異）──
  useEffect(() => {
    const offFile = editorBus.subscribe((req) => void openFile(req));
    const offDiff = editorBus.subscribeDiff((req) => void openDiff(req));
    return () => {
      offFile();
      offDiff();
    };
  }, [openFile, openDiff]);

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
        void reload(key, wsId, path); // 無未存編輯：自動重載（不打斷）
        return;
      }
      // 有未存編輯：不彈窗打斷（外部工具如 codex 會頻繁改檔），只標記「磁碟已變更」，關檔時再提醒。
      setTabs((prev) => prev.map((t) => (t.key === key && !t.diskChanged ? { ...t, diskChanged: true } : t)));
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
      <div className="pd-editor-tabs">
        {/* role=tablist 只包 role=tab 子元素（a11y）；display:contents 不影響既有 flex 版面。 */}
        <div className="pd-editor-tablist" role="tablist" aria-label="開啟的檔案" style={{ display: 'contents' }}>
          {visibleTabs.map((t) => (
            <div
              key={t.key}
              role="tab"
              tabIndex={0}
              aria-selected={t.key === activeKey}
              aria-label={`${t.name}${t.dirty ? '（未存檔）' : ''}（Delete 鍵關閉）`}
              className={`pd-editor-tab${t.key === activeKey ? ' is-active' : ''}`}
              title={t.path}
              onMouseDown={() => setActiveKey(t.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveKey(t.key);
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  void requestClose(t.key);
                }
              }}
            >
              <span className="pd-editor-tab-name">{t.name}</span>
              {t.dirty && <span className="pd-editor-dot" aria-hidden="true" />}
              {/* 關閉：滑鼠用非聚焦 span（避免 role=tab 內嵌互動）；鍵盤改按 Delete（見 onKeyDown）。 */}
              <span
                className="pd-editor-tab-close"
                role="presentation"
                aria-hidden="true"
                title="關閉（或按 Delete）"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void requestClose(t.key);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
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
        {/* diff 分頁時隱藏 Monaco 檔案 pane（保持掛載，model 已卸），改 overlay DiffView。 */}
        <div
          ref={primaryElRef}
          className="pd-editor-pane"
          role="group"
          aria-label="編輯區"
          style={active?.kind !== 'file' ? { display: 'none' } : undefined}
        />
        {split && (
          <div
            ref={secondaryElRef}
            className="pd-editor-pane pd-editor-pane-split"
            role="group"
            aria-label="分割編輯區"
            style={active?.kind !== 'file' ? { display: 'none' } : undefined}
          />
        )}
        {active?.kind === 'diff' && active.patch !== undefined && (
          <div className="pd-editor-pane pd-editor-diffpane" role="group" aria-label={`差異：${active.name}`}>
            <DiffView key={active.key} path={active.path} patch={active.patch} />
          </div>
        )}
        {active?.kind === 'sheet' && (
          <div className="pd-editor-pane" role="group" aria-label={`試算表：${active.name}`}>
            <SheetView key={active.key} wsId={active.wsId} path={active.path} />
          </div>
        )}
        {active?.kind === 'doc' && (
          <div className="pd-editor-pane" role="group" aria-label={`文件：${active.name}`}>
            <DocView key={active.key} wsId={active.wsId} path={active.path} />
          </div>
        )}
        {active?.kind === 'image' && (
          <div className="pd-editor-pane" role="group" aria-label={`圖片：${active.name}`}>
            <ImageView key={active.key} wsId={active.wsId} path={active.path} />
          </div>
        )}
        {visibleTabs.length === 0 && (
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
