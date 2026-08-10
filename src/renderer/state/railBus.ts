// 工作區 rail 顯隱匯流排（module singleton）：DockLayout toolbar「工作區」按鈕 toggle、App 訂閱顯隱。
type Listener = (visible: boolean) => void;
const listeners = new Set<Listener>();
let visible = true;
let userRevision = 0;

function publish(next: boolean, source: 'user' | 'tour'): void {
  if (visible === next) return;
  visible = next;
  if (source === 'user') userRevision += 1;
  for (const l of listeners) l(visible);
}

export const railBus = {
  toggle(): void {
    publish(!visible, 'user');
  },
  setVisible(next: boolean): void {
    publish(next, 'user');
  },
  /** 導覽暫時顯示；使用者中途親自調整後不再替他還原。 */
  revealForTour(): () => void {
    const revision = userRevision;
    const changed = !visible;
    if (changed) publish(true, 'tour');
    return () => {
      if (changed && userRevision === revision && visible) publish(false, 'tour');
    };
  },
  isVisible(): boolean {
    return visible;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
