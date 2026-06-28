// 每工作區 git 操作序列化（F-7 REQ-SCM-008、紅軍 A5）。
// 設計：Map<wsId, 鏈尾 Promise>，新 task 接在前一個「settle 之後」執行 → 同工作區 read/write 真序列，
// 不撞 index.lock。關鍵防腐：
// - 鏈尾只串「已 settle 的 reflect」（不論成敗都 resolve 推進），單一 task reject 不毒化整條鏈
//   （否則該工作區 git 永久卡死）。
// - 回傳給呼叫者的是「各自獨立」的 promise（成敗如實傳遞），與鏈尾解耦。
// - task settle 後若該 wsId 已無 pending 即刪 Map key（避免鏈無限延長 / 記憶體洩漏）。
// - 鏈尾的 rejection 一律被吞（reflect），不會冒泡成 Electron main 的 unhandledRejection。

type Task<T> = () => Promise<T> | T;

/** wsId → 鏈尾（永遠是會 resolve 的 reflect promise）。 */
const tails = new Map<string, Promise<void>>();

/**
 * 把 fn 排入 wsId 的序列佇列。回傳 fn 自己的結果 promise（成敗如實）。
 * fn 會等前一個 task settle 後才開始；本 task settle 不影響後續推進。
 */
export function enqueue<T>(wsId: string, fn: Task<T>): Promise<T> {
  const prev = tails.get(wsId) ?? Promise.resolve();

  // fn 在 prev settle 後執行（prev 必為已 resolve 的 reflect，故 catch 分支實務上不會走）。
  const result: Promise<T> = prev.then(() => fn());

  // 鏈尾＝把本 task 的成敗都吞成 resolve（reflect），確保後續 task 一定能推進、且不產生 unhandled rejection。
  const tail: Promise<void> = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(wsId, tail);

  // 清理：本 tail settle 後若仍是當前鏈尾（無新 task 追加）則刪 key，避免無限延長。
  void tail.then(() => {
    if (tails.get(wsId) === tail) tails.delete(wsId);
  });

  return result;
}

/** 目前有 in-flight 鏈的工作區數（測試用：驗證鏈會被清理、不洩漏）。 */
export function activeWorkspaceCount(): number {
  return tails.size;
}

/** 清空所有佇列狀態（測試用）。 */
export function _resetSerialQueue(): void {
  tails.clear();
}
