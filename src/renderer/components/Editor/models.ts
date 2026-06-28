// Monaco model / 語言 / uri / 主題 小工具（F-4）。
// model 以 (wsId, path) 為唯一鍵 → 同檔共享 model（REQ-EDIT-006）；語言由副檔名對映、後備比對 monaco 已註冊語言。

import * as monaco from 'monaco-editor';
import type { ThemeId } from '../../../shared/types';

/** tab / model 唯一鍵（同一 wsId+path 視為同檔，路徑正規化為 posix）。 */
export function tabKey(wsId: string, path: string): string {
  return `${wsId}::${path.replace(/\\/g, '/')}`;
}

/** model 的 monaco.Uri（含 wsId 命名空間，避免跨工作區同相對路徑碰撞）。 */
export function modelUri(wsId: string, path: string): monaco.Uri {
  const posix = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return monaco.Uri.parse('file:///' + encodeURI(`${wsId}/${posix}`));
}

/** 取路徑最後一段為顯示檔名。 */
export function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// 常見副檔名 → monaco language id（涵蓋 TS/JS 智能語言，REQ-EDIT-002）。
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', xml: 'xml', sql: 'sql', dockerfile: 'dockerfile',
};

/** 由副檔名推語言；無對映則比對 monaco 已註冊語言的 extensions；再無則 plaintext。 */
export function langFromPath(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  if (ext) {
    const dotted = '.' + ext;
    for (const l of monaco.languages.getLanguages()) {
      if (l.extensions?.some((e) => e.toLowerCase() === dotted)) return l.id;
    }
  }
  return 'plaintext';
}

/** 取 CSS 變數實際字串值（如 --font-mono → 真實字型清單）。 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 編輯區字型（對映 var(--font-mono) 的實際字串）。 */
export function monoFontFamily(): string {
  return cssVar('--font-mono', 'ui-monospace, Consolas, monospace');
}

/**
 * 依 app 主題定義並套用 Monaco 主題（讓編輯區底色/前景與設計 token 對齊，不吃預設樣式）。
 * 主題切換時重呼一次（getComputedStyle 會讀當前 [data-theme] 的 token 值）。
 */
export function applyMonacoTheme(theme: ThemeId): void {
  const base: 'vs-dark' | 'vs' = theme === 'dark' ? 'vs-dark' : 'vs';
  monaco.editor.defineTheme('polydesk', {
    base,
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--bg', base === 'vs-dark' ? '#0a0a0a' : '#ffffff'),
      'editor.foreground': cssVar('--fg', base === 'vs-dark' ? '#ededed' : '#171717'),
      'editorLineNumber.foreground': cssVar('--meta', '#6b6b6b'),
      'editorCursor.foreground': cssVar('--accent', '#0070f3'),
    },
  });
  monaco.editor.setTheme('polydesk');
}
