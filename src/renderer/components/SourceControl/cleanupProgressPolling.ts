interface CleanupProgressPollingOptions<T> {
  request: () => Promise<T>;
  onStatus: (status: T) => void;
  isCurrent: () => boolean;
  intervalMs?: number;
}

export function startCleanupProgressPolling<T>({
  request,
  onStatus,
  isCurrent,
  intervalMs = 250,
}: CleanupProgressPollingOptions<T>): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = (): boolean => active && isCurrent();
  const poll = async (): Promise<void> => {
    timer = undefined;
    if (!current()) { active = false; return; }
    try {
      const status = await request();
      if (current()) onStatus(status);
    } catch {
      // 進度查詢失敗不打斷清理；仍由原操作及最後一次狀態讀取呈現結果／錯誤。
    } finally {
      // 本次查詢結束才安排下一次，避免進度查詢堆積在 main 的 claims 佇列。
      if (current()) schedule();
      else active = false;
    }
  };
  const schedule = (): void => { timer = setTimeout(() => void poll(), intervalMs); };
  schedule();
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
