import { normalizeExternalHttpUrl } from '../../../shared/externalUrl';

export interface TerminalWebLinkMatch {
  /** xterm buffer line 內的 0-based 字串起點。 */
  start: number;
  /** xterm buffer line 內的 0-based exclusive 字串終點。 */
  end: number;
  /** 畫面原文。 */
  text: string;
  /** 已通過白名單並正規化、可交給系統瀏覽器的網址。 */
  url: string;
}

export interface TerminalWebCellLinkMatch extends TerminalWebLinkMatch {
  /** xterm buffer line 內的 0-based 起始格。 */
  cellStart: number;
  /** xterm buffer line 內的 0-based exclusive 結束格。 */
  cellEnd: number;
}

interface TerminalBufferCellLike {
  getChars(): string;
  getWidth(): number;
}

export interface TerminalWebBufferLineLike {
  length: number;
  getCell(index: number): TerminalBufferCellLike | undefined;
}

const WEB_URL = /https?:\/\/[^\s<>"'`，。；！？、\u0000-\u001f\u007f]+/giu;
const TRAILING_PUNCTUATION = /[\]}>,.;:!?，。；！？、]$/u;

/** 去除句尾標點；右括號只在沒有對應左括號時移除，保留 URL 路徑內成對括號。 */
function trimUrlToken(raw: string): string {
  let value = raw;
  while (TRAILING_PUNCTUATION.test(value)) value = value.slice(0, -1);
  while (value.endsWith(')')) {
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
    value = value.slice(0, -1);
  }
  return value;
}

/** 從一條已解 ANSI 的 xterm buffer 文字找出安全的 HTTP(S) 網址。 */
export function findTerminalWebLinks(text: string): TerminalWebLinkMatch[] {
  const matches: TerminalWebLinkMatch[] = [];
  let token: RegExpExecArray | null;
  WEB_URL.lastIndex = 0;
  while ((token = WEB_URL.exec(text))) {
    const value = trimUrlToken(token[0]);
    const url = normalizeExternalHttpUrl(value);
    if (!url) continue;
    matches.push({ start: token.index, end: token.index + value.length, text: value, url });
  }
  return matches;
}

/** 把網址的 JS 字串索引換算成 xterm 實際格位，避免前方中文或 emoji 造成點擊錯位。 */
export function findTerminalWebCellLinks(line: TerminalWebBufferLineLike): TerminalWebCellLinkMatch[] {
  let text = '';
  const cells: Array<{ textStart: number; textEnd: number; cellStart: number; cellEnd: number }> = [];
  for (let cellIndex = 0; cellIndex < line.length; cellIndex++) {
    const cell = line.getCell(cellIndex);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue;
    const chars = cell.getChars() || ' ';
    const textStart = text.length;
    text += chars;
    cells.push({ textStart, textEnd: text.length, cellStart: cellIndex, cellEnd: cellIndex + width });
  }
  text = text.replace(/ +$/, '');

  return findTerminalWebLinks(text).flatMap((match) => {
    const first = cells.find((cell) => match.start >= cell.textStart && match.start < cell.textEnd);
    const last = cells.find((cell) => match.end > cell.textStart && match.end <= cell.textEnd);
    if (!first || !last) return [];
    return [{ ...match, cellStart: first.cellStart, cellEnd: last.cellEnd }];
  });
}

/** 經 renderer 白名單後走固定 IPC 交給 main；main 會再驗證一次並改由系統瀏覽器開啟。 */
export function openTerminalWebLink(raw: string): boolean {
  const url = normalizeExternalHttpUrl(raw);
  if (!url || typeof window === 'undefined') return false;
  void window.polydesk.app.openExternalUrl({ url }).catch(() => undefined);
  return true;
}
