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
// 一般 listeners（DockLayout 叫回、LSP probe）可在 EditorGroup 不存在時常駐；真正開檔 consumer
// 獨立註冊，才能判斷「panel 被關閉、尚無 EditorGroup」並暫存本次請求，待重建後補送。
const listeners = new Set<Listener>();
const diffListeners = new Set<DiffListener>();
const editorListeners = new Set<Listener>();
const editorDiffListeners = new Set<DiffListener>();
let pendingFile: OpenFileRequest | null = null;
let pendingDiff: OpenDiffRequest | null = null;

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
    if (editorListeners.size > 0) dispatch(editorListeners, req);
    else pendingFile = req; // panel 被 dockview 關閉：保留最新一次點擊，重建 EditorGroup 後補送
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** EditorGroup 專用 consumer；新掛載時補收 panel 不存在期間最後一次開檔請求。 */
  subscribeEditor(l: Listener): () => void {
    editorListeners.add(l);
    // 延到 microtask：React StrictMode 初次 effect 會 setup→cleanup→setup；只交給仍存活的訂閱者。
    if (pendingFile) {
      queueMicrotask(() => {
        if (!editorListeners.has(l) || !pendingFile) return;
        const req = pendingFile;
        pendingFile = null;
        dispatch(new Set([l]), req);
      });
    }
    return () => editorListeners.delete(l);
  },
  /** 在編輯器區開啟差異分頁（編輯器 F-4 訂閱）。 */
  openDiff(req: OpenDiffRequest): void {
    dispatch(diffListeners, req);
    if (editorDiffListeners.size > 0) dispatch(editorDiffListeners, req);
    else pendingDiff = req;
  },
  subscribeDiff(l: DiffListener): () => void {
    diffListeners.add(l);
    return () => diffListeners.delete(l);
  },
  /** EditorGroup 專用 diff consumer；panel 重建後補送最後一次差異請求。 */
  subscribeEditorDiff(l: DiffListener): () => void {
    editorDiffListeners.add(l);
    if (pendingDiff) {
      queueMicrotask(() => {
        if (!editorDiffListeners.has(l) || !pendingDiff) return;
        const req = pendingDiff;
        pendingDiff = null;
        dispatch(new Set([l]), req);
      });
    }
    return () => editorDiffListeners.delete(l);
  },
};
