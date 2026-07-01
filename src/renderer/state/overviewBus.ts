// 總覽面板開關匯流排（module singleton）：DockLayout toolbar 的「總覽」按鈕 toggle、OverviewPanel 訂閱顯隱。
type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();
let open = false;

export const overviewBus = {
  toggle(): void {
    open = !open;
    for (const l of listeners) l(open);
  },
  close(): void {
    if (!open) return;
    open = false;
    for (const l of listeners) l(open);
  },
  isOpen(): boolean {
    return open;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
