export interface TerminalFileLinkMatch {
  /** xterm buffer line 內的 0-based 起點。 */
  start: number;
  /** xterm buffer line 內的 0-based exclusive 終點。 */
  end: number;
  /** 顯示文字（包含可選的 :line:col）。 */
  text: string;
  /** 送 main 解析的純路徑。 */
  path: string;
  line?: number;
  col?: number;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function looksLikeFilePath(value: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return false;
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^~[\\/]/.test(value) ||
    /^\.{1,2}[\\/]/.test(value) ||
    /[\\/]/.test(value) ||
    /^[^\\/:*?"<>|]+\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  );
}

function trimToken(raw: string): { value: string; leading: number } {
  let value = raw;
  let leading = 0;
  while (/^[([{]/.test(value)) {
    value = value.slice(1);
    leading++;
  }
  while (/[\])},;.，。；！？、]$/.test(value)) value = value.slice(0, -1);
  return { value, leading };
}

function parsePathAndPosition(value: string): Pick<TerminalFileLinkMatch, 'path' | 'line' | 'col'> | null {
  let path = value;
  let line: number | undefined;
  let col: number | undefined;
  const position = /^(.*):(\d+):(\d+)$/.exec(value) ?? /^(.*):(\d+)$/.exec(value);
  if (position && looksLikeFilePath(position[1])) {
    path = position[1];
    line = Number(position[2]);
    col = position[3] ? Number(position[3]) : undefined;
    if (line < 1 || (col !== undefined && col < 1)) return null;
  }
  if (!looksLikeFilePath(path) || CONTROL_CHARS.test(path)) return null;
  return { path, line, col };
}

/**
 * 從一條已解 ANSI 的 xterm buffer 文字找檔案路徑。
 * 引號內路徑可含空白；一般 token 以空白切界，並支援 path:line:col。
 */
export function findTerminalFileLinks(text: string): TerminalFileLinkMatch[] {
  const matches: TerminalFileLinkMatch[] = [];
  const tokens = /"([^"\r\n]+)"|'([^'\r\n]+)'|[^\s<>"'`，。；！？、]+/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(text))) {
    const quoted = token[1] ?? token[2];
    const raw = quoted ?? token[0];
    const quoteOffset = quoted === undefined ? 0 : 1;
    const trimmed = trimToken(raw);
    const parsed = parsePathAndPosition(trimmed.value);
    if (!parsed) continue;
    const start = token.index + quoteOffset + trimmed.leading;
    matches.push({
      start,
      end: start + trimmed.value.length,
      text: trimmed.value,
      ...parsed,
    });
  }
  return matches;
}
