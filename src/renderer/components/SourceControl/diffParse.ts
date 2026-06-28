// 把 git unified diff（git:diff 回的 {patch}）拆回 original/modified 兩側文字，
// 餵 monaco diff editor 的兩個 model（契約只回 patch，無兩版檔內容，故由 hunk 重建變更區塊）。

export interface ParsedDiff {
  original: string;
  modified: string;
}

/** 解析 unified diff hunks → {original, modified}（context 兩側皆收、- 收 original、+ 收 modified）。 */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  const original: string[] = [];
  const modified: string[] = [];
  let inHunk = false;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue; // 跳過 diff/index/---/+++ 等檔頭
    if (line.length === 0) continue; // split 尾端空字串
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const tag = line[0];
    const content = line.slice(1);
    if (tag === '+') {
      modified.push(content);
    } else if (tag === '-') {
      original.push(content);
    } else if (tag === ' ') {
      original.push(content);
      modified.push(content);
    }
  }

  return { original: original.join('\n'), modified: modified.join('\n') };
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
};

/** 由副檔名推 monaco language id（未知 → plaintext）。 */
export function langFromPath(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_LANG[ext] ?? 'plaintext';
}
