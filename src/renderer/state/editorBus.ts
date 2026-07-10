// 開檔匯流排（整合接縫）：Explorer/Search（F-2/F-6）呼 openFile，Editor（F-4）訂閱開檔。
// 解耦 feature 間直接依賴（單向：來源 → bus → 編輯器）。

export interface OpenFileRequest {
  wsId: string;
  path: string;
  /** 可選：開啟後跳到此行（搜尋點擊用，1-based）。 */
  line?: number;
  /** 可選：跳行後定位到此欄（1-based；Monaco UTF-16 欄位）。 */
  col?: number;
  /** 可選：自 (line,col) 起選取反白的長度（搜尋命中 highlight 用；0/未給＝只定位游標）。 */
  selectLen?: number;
  /** 可選：分割並排開啟。 */
  split?: boolean;
}

/** 在編輯器區開啟差異（SCM 點變更檔＝工作樹 vs HEAD；或整個 commit 的 diff）。 */
export interface OpenDiffRequest {
  wsId: string;
  path: string;
  /** 已暫存的差異（--cached）vs 未暫存（檔案 diff 用）。 */
  staged: boolean;
  /** 若給＝開 commit 的 diff（git show <commit>）；此時 path 僅作顯示標籤（PE-1）。 */
  commit?: string;
  /** commit 模式下限定單一檔（git show <commit> -- <commitPath>）；點展開的檔案用（PE-1）。 */
  commitPath?: string;
}

type Listener = (req: OpenFileRequest) => void;
type DiffListener = (req: OpenDiffRequest) => void;
const listeners = new Set<Listener>();
const diffListeners = new Set<DiffListener>();

// 派送隔離：訂閱者依註冊順序同步執行（DockLayout 叫回編輯器排在 EditorGroup 開檔之前），
// 任一訂閱者 throw 不得炸斷派送鏈，否則後面的開檔訂閱者收不到＝點檔無反應。
function dispatch<T>(subs: Set<(req: T) => void>, req: T): void {
  for (const l of subs) {
    try {
      l(req);
    } catch {
      /* 單一訂閱者失敗不拖累其他訂閱者 */
    }
  }
}

export const editorBus = {
  openFile(req: OpenFileRequest): void {
    dispatch(listeners, req);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** 在編輯器區開啟差異分頁（編輯器 F-4 訂閱）。 */
  openDiff(req: OpenDiffRequest): void {
    dispatch(diffListeners, req);
  },
  subscribeDiff(l: DiffListener): () => void {
    diffListeners.add(l);
    return () => diffListeners.delete(l);
  },
};
