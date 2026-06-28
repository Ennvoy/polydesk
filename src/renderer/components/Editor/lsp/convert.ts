// LSP ↔ monaco 純轉換（F-5）。刻意「不 import monaco」：以中性資料結構/列舉字串表達結果，
// 由 lspClient 在使用端組成 monaco 物件。如此本檔可在 node 環境單元測試（vitest），不需載入 monaco。
//
// 座標慣例：LSP 為 0-based（line/character）；monaco 為 1-based（lineNumber/column）。

/** 本橋接支援的 langId（與 main languageRegistry 鏡像；renderer 據此註冊 provider）。 */
export const LSP_LANG_IDS: readonly string[] = ['python', 'go', 'rust', 'c', 'cpp', 'java', 'csharp'];

export function isLspLang(langId: string): boolean {
  return LSP_LANG_IDS.includes(langId);
}

export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export type MarkerSeverityName = 'error' | 'warning' | 'info' | 'hint';

/** LSP DiagnosticSeverity（1..4）→ marker 嚴重度關鍵字。未指定 → error（對齊 VSCode）。 */
export function lspSeverityName(sev: number | undefined): MarkerSeverityName {
  switch (sev) {
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
      return 'hint';
    case 1:
    default:
      return 'error';
  }
}

/** LSP Range → monaco range（0-based → 1-based）。缺值安全退化。 */
export function lspRangeToMonaco(range: unknown): MonacoRange {
  const r = range as
    | { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
    | undefined;
  const sl = num(r?.start?.line);
  const sc = num(r?.start?.character);
  const el = r?.end?.line === undefined ? sl : num(r?.end?.line);
  const ec = r?.end?.character === undefined ? sc : num(r?.end?.character);
  return {
    startLineNumber: sl + 1,
    startColumn: sc + 1,
    endLineNumber: el + 1,
    endColumn: ec + 1,
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

export interface MarkerData extends MonacoRange {
  message: string;
  severity: MarkerSeverityName;
  source?: string;
  code?: string;
}

/** LSP diagnostics[] → marker 中介資料[]（severity 以關鍵字表達，由使用端對映 monaco enum）。 */
export function lspDiagnosticsToMarkers(diags: unknown): MarkerData[] {
  if (!Array.isArray(diags)) return [];
  return diags.map((d) => {
    const o = (d ?? {}) as { message?: unknown; severity?: unknown; range?: unknown; source?: unknown; code?: unknown };
    return {
      ...lspRangeToMonaco(o.range),
      message: typeof o.message === 'string' ? o.message : '',
      severity: lspSeverityName(typeof o.severity === 'number' ? o.severity : undefined),
      source: typeof o.source === 'string' ? o.source : undefined,
      code: o.code === undefined || o.code === null ? undefined : String(o.code),
    };
  });
}

// monaco.languages.CompletionItemKind 的鍵名（由使用端以 monaco enum 查值）。
export type CompletionKindName =
  | 'Method' | 'Function' | 'Constructor' | 'Field' | 'Variable' | 'Class' | 'Struct'
  | 'Interface' | 'Module' | 'Property' | 'Event' | 'Operator' | 'Unit' | 'Value'
  | 'Constant' | 'Enum' | 'EnumMember' | 'Keyword' | 'Text' | 'Color' | 'File'
  | 'Reference' | 'Folder' | 'TypeParameter' | 'Snippet';

const LSP_COMPLETION_KIND: Readonly<Record<number, CompletionKindName>> = {
  1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', 5: 'Field', 6: 'Variable',
  7: 'Class', 8: 'Interface', 9: 'Module', 10: 'Property', 11: 'Unit', 12: 'Value',
  13: 'Enum', 14: 'Keyword', 15: 'Snippet', 16: 'Color', 17: 'File', 18: 'Reference',
  19: 'Folder', 20: 'EnumMember', 21: 'Constant', 22: 'Struct', 23: 'Event',
  24: 'Operator', 25: 'TypeParameter',
};

/** LSP CompletionItemKind → monaco kind 鍵名（未知 → Text）。 */
export function lspCompletionKindName(kind: number | undefined): CompletionKindName {
  return (kind !== undefined && LSP_COMPLETION_KIND[kind]) || 'Text';
}

export interface CompletionRaw {
  label: string;
  kind: CompletionKindName;
  insertText: string;
  isSnippet: boolean;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  /** textEdit.range（若有）→ 使用端據此設定 replace 範圍。 */
  range?: MonacoRange;
}

/** 取 markup（string | {kind,value}）為字串。 */
function markupToString(m: unknown): string | undefined {
  if (typeof m === 'string') return m || undefined;
  if (m && typeof m === 'object') {
    const v = (m as { value?: unknown }).value;
    if (typeof v === 'string') return v || undefined;
  }
  return undefined;
}

function labelToString(label: unknown): string {
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    const l = (label as { label?: unknown }).label;
    if (typeof l === 'string') return l;
  }
  return '';
}

/** LSP completion result（CompletionItem[] | {items} | null）→ 中介項目[]。 */
export function extractCompletionItems(result: unknown): CompletionRaw[] {
  const items: unknown[] = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown[] }).items)
      ? (result as { items: unknown[] }).items
      : [];
  return items.map(toCompletionRaw);
}

function toCompletionRaw(it: unknown): CompletionRaw {
  const o = (it ?? {}) as {
    label?: unknown;
    kind?: unknown;
    insertText?: unknown;
    insertTextFormat?: unknown;
    detail?: unknown;
    documentation?: unknown;
    sortText?: unknown;
    filterText?: unknown;
    textEdit?: { range?: unknown; newText?: unknown };
  };
  const label = labelToString(o.label);
  const isSnippet = o.insertTextFormat === 2; // LSP InsertTextFormat.Snippet
  const editText = o.textEdit && typeof o.textEdit.newText === 'string' ? o.textEdit.newText : undefined;
  const insertText =
    editText ?? (typeof o.insertText === 'string' ? o.insertText : label);
  return {
    label,
    kind: lspCompletionKindName(typeof o.kind === 'number' ? o.kind : undefined),
    insertText,
    isSnippet,
    detail: typeof o.detail === 'string' ? o.detail : undefined,
    documentation: markupToString(o.documentation),
    sortText: typeof o.sortText === 'string' ? o.sortText : undefined,
    filterText: typeof o.filterText === 'string' ? o.filterText : undefined,
    range: o.textEdit?.range ? lspRangeToMonaco(o.textEdit.range) : undefined,
  };
}

export interface HoverResult {
  value: string;
  range?: MonacoRange;
}

/** LSP Hover（contents: string | MarkupContent | MarkedString | array）→ markdown 字串 + range。 */
export function lspHoverToMarkdown(hover: unknown): HoverResult | null {
  if (!hover || typeof hover !== 'object') return null;
  const o = hover as { contents?: unknown; range?: unknown };
  const value = hoverContentsToString(o.contents);
  if (!value) return null;
  return { value, range: o.range ? lspRangeToMonaco(o.range) : undefined };
}

function hoverContentsToString(contents: unknown): string {
  if (contents == null) return '';
  if (Array.isArray(contents)) {
    return contents.map(hoverContentsToString).filter((s) => s.length > 0).join('\n\n');
  }
  if (typeof contents === 'string') return contents;
  if (typeof contents === 'object') {
    const v = (contents as { value?: unknown }).value;
    if (typeof v === 'string') return v;
  }
  return '';
}

export interface LocationTarget {
  uri: string;
  range: MonacoRange;
}

/** LSP definition result（Location | Location[] | LocationLink[] | null）→ 目標[]。 */
export function lspLocationsToTargets(result: unknown): LocationTarget[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  const out: LocationTarget[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as {
      uri?: unknown;
      range?: unknown;
      targetUri?: unknown;
      targetRange?: unknown;
      targetSelectionRange?: unknown;
    };
    if (typeof o.uri === 'string') {
      out.push({ uri: o.uri, range: lspRangeToMonaco(o.range) });
    } else if (typeof o.targetUri === 'string') {
      out.push({ uri: o.targetUri, range: lspRangeToMonaco(o.targetSelectionRange ?? o.targetRange) });
    }
  }
  return out;
}

/** monaco 同步檔案的 model uri（file:///wsId/relPath）解析回 {wsId, rel}（與 F-4 models.ts modelUri 逆向）。 */
export function parseModelUriPath(uriPath: string): { wsId: string; rel: string } | null {
  if (typeof uriPath !== 'string') return null;
  const p = uriPath.replace(/^\/+/, '');
  if (!p) return null;
  const i = p.indexOf('/');
  if (i < 0) return { wsId: decodeURIComponent(p), rel: '' };
  return { wsId: decodeURIComponent(p.slice(0, i)), rel: decodeURIComponent(p.slice(i + 1)) };
}

/** 真實檔案系統路徑 → 落在哪個工作區（回相對 POSIX 路徑）。供 definition/diagnostics 反查 wsId。 */
export function fsPathToWorkspace(
  fsPath: string,
  workspaces: { id: string; path: string }[],
  caseInsensitive = true,
): { wsId: string; rel: string } | null {
  if (typeof fsPath !== 'string' || !fsPath) return null;
  const toPosix = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const fold = (s: string): string => (caseInsensitive ? s.toLowerCase() : s);
  const targetPosix = toPosix(fsPath);
  const targetFold = fold(targetPosix);
  for (const w of workspaces) {
    const rootPosix = toPosix(w.path);
    const rootFold = fold(rootPosix);
    if (targetFold === rootFold) return { wsId: w.id, rel: '' };
    if (targetFold.startsWith(rootFold + '/')) {
      return { wsId: w.id, rel: targetPosix.slice(rootPosix.length).replace(/^\/+/, '') };
    }
  }
  return null;
}
