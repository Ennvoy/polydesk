import type { GitWorktree } from '../../shared/types';

interface BranchRequest {
  wsId: string;
  path: string;
  mainPath: string;
}

type ListResult = { list: GitWorktree[] } | { error: string };
type ListFetcher = (wsId: string) => Promise<ListResult>;

/** 分支徽章只讀 metadata；同主工作樹的徽章共用清單，不掃描各工作樹。 */
export function createWorktreeBranchLoader(
  fetcher: ListFetcher,
  cacheMs = 600,
  now: () => number = Date.now,
  caseInsensitive = typeof navigator !== 'undefined' && /win/i.test(navigator.platform),
): {
  load: (request: BranchRequest) => Promise<string | null | undefined>;
  invalidate: (path?: string) => void;
  subscribe: (mainPath: string, listener: () => void) => () => void;
} {
  const normalize = (path: string): string => {
    const normalized = path.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const pending = new Map<string, { generation: number; promise: Promise<GitWorktree[]> }>();
  const cached = new Map<string, { expiresAt: number; list: GitWorktree[] }>();
  const generations = new Map<string, number>();
  const aliases = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();

  const loadList = (request: BranchRequest): Promise<GitWorktree[]> => {
    const key = normalize(request.mainPath);
    aliases.set(normalize(request.path), key);
    const generation = generations.get(key) ?? 0;
    const current = pending.get(key);
    if (current) {
      if (current.generation === generation) return current.promise;
      return current.promise.catch(() => undefined).then(() => loadList(request));
    }
    const hit = cached.get(key);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.list);
    let promise: Promise<GitWorktree[]>;
    promise = fetcher(request.wsId).then((result) => {
      if (!('list' in result)) throw new Error(result.error);
      if ((generations.get(key) ?? 0) === generation) {
        cached.set(key, { expiresAt: now() + cacheMs, list: result.list });
      }
      return result.list;
    }).finally(() => {
      if (pending.get(key)?.promise === promise) pending.delete(key);
    });
    pending.set(key, { generation, promise });
    return promise;
  };

  return {
    async load(request) {
      const list = await loadList(request);
      const entry = list.find((worktree) => worktree.managedWsId === request.wsId)
        ?? list.find((worktree) => normalize(worktree.path) === normalize(request.path));
      return entry && !entry.prunable ? entry.branch : undefined;
    },
    invalidate(path) {
      const normalized = path === undefined ? undefined : normalize(path);
      const keys = normalized === undefined
        ? new Set([...pending.keys(), ...cached.keys(), ...listeners.keys()])
        : new Set([aliases.get(normalized) ?? normalized]);
      for (const key of keys) {
        cached.delete(key);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        for (const listener of listeners.get(key) ?? []) listener();
      }
    },
    subscribe(mainPath, listener) {
      const key = normalize(mainPath);
      const group = listeners.get(key) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(key, group);
      return () => {
        group.delete(listener);
        if (group.size === 0) listeners.delete(key);
      };
    },
  };
}
