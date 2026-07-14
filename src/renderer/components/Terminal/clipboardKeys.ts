// 終端機剪貼簿快捷鍵判定（純函式，供 TerminalView 與單測共用；不依賴 xterm/DOM，可 node 單測）。
//
// 為何需要自己判定：xterm 預設把 Ctrl+V 對應成控制字元 ^V（0x16）並 cancel 事件，永遠不會貼上
// （傳統終端慣例是 Ctrl+Shift+V 貼上、Ctrl+V 為「literal next」）。但本 app 面向 Windows 使用者、
// 且常在終端機內跑 Claude Code 等 TUI——期望的是 Windows 風「Ctrl+V＝貼上」（VS Code 終端機亦如此）。
// 故攔 Ctrl/Cmd+V（含 +Shift）、Shift+Insert → 貼上；Ctrl/Cmd+C → 複製候選。
// 純 Ctrl+C 最終是否攔截由 TerminalView 依「有無選取」判定，無選取時仍保留給 SIGINT。

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
  // 複製候選：是否真的攔截由 TerminalView 依目前有無選取決定。
  if (mod && e.code === 'KeyC') return 'copy';
  return null;
}
