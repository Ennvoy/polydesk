// 工作區生命週期 / teardown 協調（REQ-WS-009）。
// 各 concern（pty / watcher / monitor / playwright）以 key 註冊一個 teardown handler；
// 移除工作區或關閉 app 時依序呼叫，單一 concern 失敗被隔離、不影響其他（避免殭屍程序）。

export type TeardownHandler = (wsId: string) => void | Promise<void>;

export class WorkspaceLifecycle {
  private readonly handlers = new Map<string, TeardownHandler>();

  /** 註冊某 concern 的 teardown（同 key 覆蓋）。回傳取消註冊函式。 */
  register(concern: string, handler: TeardownHandler): () => void {
    this.handlers.set(concern, handler);
    return () => this.handlers.delete(concern);
  }

  /** 對某工作區執行所有已註冊 teardown；單一失敗隔離、不中斷其餘。 */
  async teardown(wsId: string): Promise<void> {
    for (const [concern, handler] of this.handlers) {
      try {
        await handler(wsId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[Polydesk] teardown failed concern="${concern}" ws=${wsId}:`, e);
      }
    }
  }

  /**
   * 破壞性 worktree 清理用：所有 concern 都會執行，但任一失敗會在最後以 AggregateError 回報，
   * 呼叫端因此能保留 workspace/Git 登記並停止刪除，不把部分 teardown 冒充成功。
   */
  async teardownStrict(wsId: string): Promise<void> {
    const failures: Error[] = [];
    for (const [concern, handler] of this.handlers) {
      try {
        await handler(wsId);
      } catch (error) {
        failures.push(new Error(`concern=${concern}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, '工作區仍有無法安全關閉的程序或監看服務。');
  }

  /** 已註冊的 concern 數（測試用）。 */
  get size(): number {
    return this.handlers.size;
  }
}
