// 開檔匯流排（整合接縫）：Explorer/Search（F-2/F-6）呼 openFile，Editor（F-4）訂閱開檔。
// 解耦 feature 間直接依賴（單向：來源 → bus → 編輯器）。

export interface OpenFileRequest {
  wsId: string;
  path: string;
  /** 可選：開啟後跳到此行（搜尋點擊用，1-based）。 */
  line?: number;
  /** 可選：分割並排開啟。 */
  split?: boolean;
}

/** 在編輯器區開啟差異（SCM 點變更檔＝工作樹 vs HEAD；或整個 commit 的 diff）。 */
export interface OpenDiffRequest {
  wsId: string;
  path: string;
  /** 已暫存的差異（--cached）vs 未暫存（檔案 diff 用）。 */
  staged: boolean;
  /** 若給＝開整個 commit 的 diff（git show <commit>）；此時 path 僅作顯示標籤（PE-1）。 */
  commit?: string;
}

type Listener = (req: OpenFileRequest) => void;
type DiffListener = (req: OpenDiffRequest) => void;
const listeners = new Set<Listener>();
const diffListeners = new Set<DiffListener>();

export const editorBus = {
  openFile(req: OpenFileRequest): void {
    for (const l of listeners) l(req);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** 在編輯器區開啟差異分頁（編輯器 F-4 訂閱）。 */
  openDiff(req: OpenDiffRequest): void {
    for (const l of diffListeners) l(req);
  },
  subscribeDiff(l: DiffListener): () => void {
    diffListeners.add(l);
    return () => diffListeners.delete(l);
  },
};
