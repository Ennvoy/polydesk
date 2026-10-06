// 每 repository Git 寫入序列化（F-7 REQ-SCM-008、紅軍 A5）。
// 同批只讀 task 可並行，狀態掃描最多兩個；寫入等待全部前序讀取，後序讀取等待寫入，
// 不撞 index.lock。關鍵防腐：
// - 鏈尾只串「已 settle 的 reflect」（不論成敗都 resolve 推進），單一 task reject 不毒化整條鏈
//   （否則該工作區 git 永久卡死）。
// - 回傳給呼叫者的是「各自獨立」的 promise（成敗如實傳遞），與鏈尾解耦。
// - task settle 後若該 repository 已無 pending 即刪 Map key（避免鏈無限延長 / 記憶體洩漏）。
// - 鏈尾的 rejection 一律被吞（reflect），不會冒泡成 Electron main 的 unhandledRejection。

type Task<T> = () => Promise<T> | T;

/** repo key → 鏈尾。readStart 是本批並行讀取前的屏障。 */
const tails = new Map<string, { tail: Promise<void>; readStart?: Promise<void> }>();
const scans = new Map<string, { active: number; waiters: Array<() => void> }>();
const MAX_CONCURRENT_SCANS = 2;

/**
 * 把 fn 排入 wsId 的序列佇列。回傳 fn 自己的結果 promise（成敗如實）。
 * fn 會等前一個 task settle 後才開始；本 task settle 不影響後續推進。
 */
export function enqueue<T>(wsId: string, fn: Task<T>): Promise<T> {
  const prev = tails.get(wsId)?.tail ?? Promise.resolve();

  // fn 在 prev settle 後執行（prev 必為已 resolve 的 reflect，故 catch 分支實務上不會走）。
  const result: Promise<T> = prev.then(() => fn());

  // 鏈尾＝把本 task 的成敗都吞成 resolve（reflect），確保後續 task 一定能推進、且不產生 unhandled rejection。
  const tail: Promise<void> = result.then(
    () => undefined,
    () => undefined,
  );
  const entry = { tail };
  tails.set(wsId, entry);

  // 清理：本 tail settle 後若仍是當前鏈尾（無新 task 追加）則刪 key，避免無限延長。
  void tail.then(() => {
    if (tails.get(wsId) === entry) tails.delete(wsId);
  });

  return result;
}

/** 同一批唯讀操作可並行；已排入的寫入仍是前後讀取間的屏障。 */
export function enqueueRead<T>(wsId: string, fn: Task<T>): Promise<T> {
  const previous = tails.get(wsId);
  const start = previous?.readStart ?? previous?.tail ?? Promise.resolve();
  const result: Promise<T> = start.then(() => fn());
  const settled = result.then(() => undefined, () => undefined);
  const tail = previous?.readStart
    ? Promise.all([previous.tail, settled]).then(() => undefined)
    : settled;
  const entry = { tail, readStart: start };
  tails.set(wsId, entry);
  void tail.then(() => {
    if (tails.get(wsId) === entry) tails.delete(wsId);
  });
  return result;
}

/** 工作樹狀態掃描較重；限流不阻塞同批的歷史、分支和 worktree metadata 讀取。 */
export function enqueueScan<T>(wsId: string, fn: Task<T>): Promise<T> {
  return enqueueRead(wsId, async () => {
    let state = scans.get(wsId);
    if (!state) {
      state = { active: 0, waiters: [] };
      scans.set(wsId, state);
    }
    if (state.active >= MAX_CONCURRENT_SCANS) {
      await new Promise<void>((resolve) => { state!.waiters.push(resolve); });
    } else {
      state.active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = state.waiters.shift();
      if (next) next();
      else {
        state.active -= 1;
        if (state.active === 0 && scans.get(wsId) === state) scans.delete(wsId);
      }
    }
  });
}

/** 目前有 in-flight 鏈的工作區數（測試用：驗證鏈會被清理、不洩漏）。 */
export function activeWorkspaceCount(): number {
  return tails.size;
}

/** 清空所有佇列狀態（測試用）。 */
export function _resetSerialQueue(): void {
  tails.clear();
  scans.clear();
}
