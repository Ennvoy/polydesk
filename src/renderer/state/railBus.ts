// 工作區 rail 顯隱匯流排（module singleton）：DockLayout toolbar「工作區」按鈕 toggle、App 訂閱顯隱。
type Listener = (visible: boolean) => void;
const listeners = new Set<Listener>();
let visible = true;

export const railBus = {
  toggle(): void {
    visible = !visible;
    for (const l of listeners) l(visible);
  },
  isVisible(): boolean {
    return visible;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
