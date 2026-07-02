// 終端機剪貼簿快捷鍵判定（純函式，供 TerminalView 與單測共用；不依賴 xterm/DOM，可 node 單測）。
//
// 為何需要自己判定：xterm 預設把 Ctrl+V 對應成控制字元 ^V（0x16）並 cancel 事件，永遠不會貼上
// （傳統終端慣例是 Ctrl+Shift+V 貼上、Ctrl+V 為「literal next」）。但本 app 面向 Windows 使用者、
// 且常在終端機內跑 Claude Code 等 TUI——期望的是 Windows 風「Ctrl+V＝貼上」（VS Code 終端機亦如此）。
// 故攔 Ctrl/Cmd+V（含 +Shift）、Shift+Insert → 貼上；Ctrl/Cmd+Shift+C → 複製選取。
// 刻意「不攔」純 Ctrl+C：保留給 SIGINT（中斷前景程序），這是終端機不可或缺的行為。

export type ClipboardAction = 'paste' | 'copy' | null;

/** 只取判定所需欄位；用 KeyboardEvent 的子集，方便單測建構 plain object。 */
export interface ClipboardKeyLike {
  type: string;
  /** 佈局無關的實體鍵碼（如 'KeyV'/'KeyC'/'Insert'），比 key 穩健（不受 Shift/CapsLock/佈局影響）。 */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function classifyClipboardKey(e: ClipboardKeyLike): ClipboardAction {
  if (e.type !== 'keydown') return null; // 只在 keydown 動作，避免 keyup/keypress 重複觸發
  const mod = e.ctrlKey || e.metaKey;
  // 貼上：Ctrl/Cmd+V（含 +Shift）、Shift+Insert
  if ((mod && e.code === 'KeyV') || (e.shiftKey && e.code === 'Insert')) return 'paste';
  // 複製：Ctrl/Cmd+Shift+C（純 Ctrl+C 不攔＝保留 SIGINT）
  if (mod && e.shiftKey && e.code === 'KeyC') return 'copy';
  return null;
}
