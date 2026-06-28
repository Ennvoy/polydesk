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

type Listener = (req: OpenFileRequest) => void;
const listeners = new Set<Listener>();

export const editorBus = {
  openFile(req: OpenFileRequest): void {
    for (const l of listeners) l(req);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
