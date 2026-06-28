// LSP ↔ monaco 接線（F-5：REQ-EDIT-003/004/005、REQ-E2E-002 後半）。
// (a) 對支援語言註冊全域 completion/hover/definition provider（呼 ipc.lsp.request → 轉 monaco）；
// (b) 訂閱 ipc.events.lsp.diagnostics → setModelMarkers；
// (c) editorBus 偵測開檔 → probe，缺件顯示不擋路 toast；monaco model 生命週期驅動 didOpen/didChange/didClose。
//
// 設計：provider「永遠」發 request（main 缺件/未信任/巨檔會回 error/降級，provider 回空，不擋編輯）；
// toast 僅由 probe 結果驅動（每 langId 一次）。uri 一律用「真實磁碟 file:// uri」與 LS 溝通；monaco model
// 仍用 F-4 的 wsId 命名空間 uri，兩者經 workspace.path 互轉。F-4 EditorGroup 不需改（provider 全域、per-language）。

import * as monaco from 'monaco-editor';
import { ipc } from '../../../ipc/client';
import { editorBus } from '../../../state/editorBus';
import { appStore } from '../../../state/appStore';
import { modelUri, langFromPath } from '../models';
import {
  extractCompletionItems,
  fsPathToWorkspace,
  isLspLang,
  LSP_LANG_IDS,
  lspDiagnosticsToMarkers,
  lspHoverToMarkdown,
  lspLocationsToTargets,
  parseModelUriPath,
  type MarkerSeverityName,
  type MonacoRange,
} from './convert';
import { showMissingServerToast } from './missingServerToast';

/** 巨檔不啟 LSP（與 main maxFileBytes 一致；renderer 以字元數近似，A4 縱深）。 */
const MAX_LSP_CHARS = 5 * 1024 * 1024;
const CHANGE_DEBOUNCE_MS = 250;
const MARKER_OWNER = 'polydesk-lsp';

interface DocState {
  wsId: string;
  langId: string;
  lspUri: string;
  version: number;
  disabled: boolean;
  changeSub: monaco.IDisposable | null;
  debounce: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, DocState>(); // key: model.uri.toString()
const probedLangs = new Map<string, boolean>(); // langId → available（toast 去重）
let installed = false;

/** 由 monaco model 解出 wsId / 相對路徑 / 真實磁碟 lsp uri。 */
function docFromModel(model: monaco.editor.ITextModel): { wsId: string; rel: string; lspUri: string } | null {
  const parsed = parseModelUriPath(model.uri.path);
  if (!parsed) return null;
  const ws = appStore.getState().workspaces.find((w) => w.id === parsed.wsId);
  if (!ws) return null;
  const base = ws.path.replace(/[\\/]+$/, '');
  const fsPath = parsed.rel ? `${base}/${parsed.rel}` : base;
  return { wsId: parsed.wsId, rel: parsed.rel, lspUri: monaco.Uri.file(fsPath).toString() };
}

function toMonacoRange(r: MonacoRange): monaco.Range {
  return new monaco.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn);
}

function severityToMonaco(name: MarkerSeverityName): monaco.MarkerSeverity {
  switch (name) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
      return monaco.MarkerSeverity.Info;
    case 'hint':
      return monaco.MarkerSeverity.Hint;
  }
}

function lspPosition(position: monaco.Position): { line: number; character: number } {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

async function lspRequest(wsId: string, langId: string, method: string, params: unknown): Promise<unknown | null> {
  try {
    const res = await ipc.lsp.request({ wsId, langId, method, params });
    if (res && typeof res === 'object' && 'error' in res && res.error) return null; // 缺件/逾時 → 降級回空
    return (res as { result?: unknown }).result ?? null;
  } catch {
    return null;
  }
}

// ── (a) provider 註冊 ──

function registerProviders(): void {
  for (const langId of LSP_LANG_IDS) {
    monaco.languages.registerCompletionItemProvider(langId, {
      triggerCharacters: ['.', ':', '>', '<', '"', "'", '/', '@', '(', ' '],
      async provideCompletionItems(model, position) {
        const d = docFromModel(model);
        if (!d) return { suggestions: [] };
        const result = await lspRequest(d.wsId, langId, 'textDocument/completion', {
          textDocument: { uri: d.lspUri },
          position: lspPosition(position),
        });
        const items = extractCompletionItems(result);
        const word = model.getWordUntilPosition(position);
        const defaultRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const suggestions: monaco.languages.CompletionItem[] = items.map((it) => ({
          label: it.label,
          kind: monaco.languages.CompletionItemKind[it.kind] ?? monaco.languages.CompletionItemKind.Text,
          insertText: it.insertText,
          insertTextRules: it.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail: it.detail,
          documentation: it.documentation ? { value: it.documentation } : undefined,
          sortText: it.sortText,
          filterText: it.filterText,
          range: it.range ? toMonacoRange(it.range) : defaultRange,
        }));
        return { suggestions };
      },
    });

    monaco.languages.registerHoverProvider(langId, {
      async provideHover(model, position) {
        const d = docFromModel(model);
        if (!d) return null;
        const result = await lspRequest(d.wsId, langId, 'textDocument/hover', {
          textDocument: { uri: d.lspUri },
          position: lspPosition(position),
        });
        const h = lspHoverToMarkdown(result);
        if (!h) return null;
        return { contents: [{ value: h.value }], range: h.range ? toMonacoRange(h.range) : undefined };
      },
    });

    monaco.languages.registerDefinitionProvider(langId, {
      async provideDefinition(model, position) {
        const d = docFromModel(model);
        if (!d) return null;
        const result = await lspRequest(d.wsId, langId, 'textDocument/definition', {
          textDocument: { uri: d.lspUri },
          position: lspPosition(position),
        });
        const targets = lspLocationsToTargets(result);
        if (targets.length === 0) return null;

        const workspaces = appStore.getState().workspaces;
        const locations: monaco.languages.Location[] = [];
        let firstNav: { wsId: string; path: string; line: number } | null = null;
        for (const t of targets) {
          if (!t.uri.startsWith('file:')) continue;
          const fsPath = monaco.Uri.parse(t.uri).fsPath;
          const map = fsPathToWorkspace(fsPath, workspaces);
          if (!map) continue;
          if (!firstNav) firstNav = { wsId: map.wsId, path: map.rel, line: t.range.startLineNumber };
          const muri = modelUri(map.wsId, map.rel);
          if (monaco.editor.getModel(muri)) {
            locations.push({ uri: muri, range: toMonacoRange(t.range) });
          }
        }
        // best-effort 導航：開啟主目標（建立 model）；peek 對已開檔顯示既有 model。
        if (firstNav) editorBus.openFile(firstNav);
        return locations;
      },
    });
  }
}

// ── (b) diagnostics → markers ──

function subscribeDiagnostics(): void {
  ipc.events.lsp.diagnostics(({ uri, diagnostics }) => {
    if (!uri.startsWith('file:')) return;
    const fsPath = monaco.Uri.parse(uri).fsPath;
    const map = fsPathToWorkspace(fsPath, appStore.getState().workspaces);
    if (!map) return;
    const model = monaco.editor.getModel(modelUri(map.wsId, map.rel));
    if (!model) return;
    const markers = lspDiagnosticsToMarkers(diagnostics).map((m) => ({
      severity: severityToMonaco(m.severity),
      message: m.message,
      startLineNumber: m.startLineNumber,
      startColumn: m.startColumn,
      endLineNumber: m.endLineNumber,
      endColumn: m.endColumn,
      source: m.source,
      code: m.code,
    }));
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  });
}

// ── (c) model 生命週期 → 文件同步 + editorBus probe ──

function syncModel(model: monaco.editor.ITextModel, kind: 'open' | 'change' | 'close'): void {
  const state = docs.get(model.uri.toString());
  if (!state || state.disabled) return;
  void ipc.lsp
    .sync({
      wsId: state.wsId,
      langId: state.langId,
      uri: state.lspUri,
      version: state.version,
      kind,
      text: kind === 'close' ? undefined : model.getValue(),
    })
    .catch(() => {
      /* 降級：同步失敗不擋編輯 */
    });
}

function onModelAdd(model: monaco.editor.ITextModel): void {
  const key = model.uri.toString();
  if (docs.has(key)) return;
  const langId = model.getLanguageId();
  if (!isLspLang(langId)) return;
  const d = docFromModel(model);
  if (!d) return;
  const disabled = model.getValueLength() > MAX_LSP_CHARS; // A4：巨檔不啟 LSP（仍語法高亮）
  const state: DocState = {
    wsId: d.wsId,
    langId,
    lspUri: d.lspUri,
    version: model.getVersionId(),
    disabled,
    changeSub: null,
    debounce: null,
  };
  docs.set(key, state);
  if (disabled) return;

  syncModel(model, 'open');
  state.changeSub = model.onDidChangeContent(() => {
    state.version = model.getVersionId();
    if (state.debounce) clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      state.debounce = null;
      syncModel(model, 'change');
    }, CHANGE_DEBOUNCE_MS);
  });
}

function onModelRemove(model: monaco.editor.ITextModel): void {
  const key = model.uri.toString();
  const state = docs.get(key);
  if (!state) return;
  if (!state.disabled) syncModel(model, 'close');
  if (state.debounce) clearTimeout(state.debounce);
  state.changeSub?.dispose();
  docs.delete(key);
}

function subscribeModels(): void {
  monaco.editor.onDidCreateModel(onModelAdd);
  monaco.editor.onWillDisposeModel(onModelRemove);
  for (const m of monaco.editor.getModels()) onModelAdd(m); // 已建立的 model（late registration）
}

function subscribeEditorBus(): void {
  editorBus.subscribe((req) => {
    const langId = langFromPath(req.path);
    if (!isLspLang(langId)) return;
    if (probedLangs.has(langId)) return; // 每 langId 探測一次（toast 自身另去重）
    void ipc.lsp
      .probe({ langId })
      .then((info) => {
        probedLangs.set(langId, info.available);
        if (!info.available) showMissingServerToast(info); // 不擋路提示（REQ-EDIT-005）
      })
      .catch(() => {
        /* probe 失敗：保守不提示 */
      });
  });
}

/** 安裝 LSP 橋接（idempotent；features.ts 經 index 以 side-effect import 觸發一次）。 */
export function installLspBridge(): void {
  if (installed) return;
  installed = true;
  registerProviders();
  subscribeDiagnostics();
  subscribeModels();
  subscribeEditorBus();
}
