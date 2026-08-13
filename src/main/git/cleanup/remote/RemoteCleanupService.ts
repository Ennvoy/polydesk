import { createHash, randomUUID } from 'node:crypto';
import { validateRef } from '../../gitSafeArgs';
import { RemoteGitRunner, type RemoteGitOutput } from './RemoteGitRunner';
import {
  analyzeTrackingRefs,
  canonicalRefspecDigest,
  parseFetchRefspecConfig,
} from './refspecMapping';
import {
  endpointDisplay,
  endpointFingerprint,
  endpointLeaseId,
  redactRemoteError,
} from './remoteIdentity';
import type {
  RemoteCleanupExecuteRequest,
  RemoteCleanupJournal,
  RemoteCleanupPlan,
  RemoteCleanupResult,
  RemoteEndpointLease,
  RemoteEndpointResult,
  RemoteLeaseGuard,
  RemoteTrackingLease,
} from './RemoteCleanupTypes';

const CONFIG_INPUT_PATTERN = '^(remote\\..*\\.(url|pushurl)|url\\..*\\.(insteadOf|pushInsteadOf))$';
const FETCH_PATTERN = '^remote\\..*\\.fetch$';
const OBJECT_GRAPH_CONFIG_PATTERN = '^(extensions\\.partialClone|remote\\..*\\.(promisor|partialclonefilter))$';
const MAX_CACHED_PLANS = 64;

interface InternalEndpoint extends RemoteEndpointLease {
  rawEndpoint: string;
}

interface InternalPlan {
  publicPlan: RemoteCleanupPlan;
  endpoints: InternalEndpoint[];
}

interface RefState {
  ref: string;
  oid: string;
  objectType: string;
  symref: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseAdvertisedOid(raw: string, ref: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const [oid = '', advertised = ''] = line.trim().split(/\s+/, 2);
    if (advertised === ref && /^[0-9a-f]{40,64}$/i.test(oid)) return oid.toLowerCase();
  }
  return null;
}

function parseRefStates(raw: string): RefState[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    const [ref = '', oid = '', objectType = '', symref = ''] = line.split('\0');
    return ref ? [{ ref, oid, objectType, symref }] : [];
  });
}

function outputDigest(output: RemoteGitOutput): string {
  return digest({ code: output.code, stdout: output.stdout });
}

function localIdentityDigest(output: RemoteGitOutput, excludeRef?: string): string {
  const refs = output.stdout.split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !excludeRef || !line.startsWith(`${excludeRef}\0`))
    .sort((a, b) => a.localeCompare(b));
  return digest({ code: output.code, refs });
}

function requireRead(output: RemoteGitOutput, message: string): string {
  if (output.code !== 0) throw new Error(message);
  return output.stdout;
}

function pushDeletedExactRef(output: RemoteGitOutput, ref: string): boolean {
  if (output.code !== 0) return false;
  return output.stdout.split(/\r?\n/).some((line) => {
    const fields = line.split('\t');
    return fields[0] === '-' && fields[1] === `:${ref}`;
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export class RemoteCleanupService {
  private readonly plans = new Map<string, InternalPlan>();

  constructor(
    private readonly guard: RemoteLeaseGuard,
    private readonly git = new RemoteGitRunner(),
  ) {}

  private rememberPlan(token: string, plan: InternalPlan): void {
    if (!this.plans.has(token) && this.plans.size >= MAX_CACHED_PLANS) {
      const oldest = this.plans.keys().next().value as string | undefined;
      if (oldest) this.plans.delete(oldest);
    }
    this.plans.set(token, plan);
  }

  /** 只有 renderer 已明確 opt-in 遠端清理時才呼叫；本方法會連線所有 effective push endpoints。 */
  async discover(cwd: string, branch: string, localBranch = branch): Promise<RemoteCleanupPlan> {
    if (!validateRef(branch) || !validateRef(localBranch)) throw new Error('無效的本地或遠端分支名稱。');
    const localTargetRef = `refs/heads/${localBranch}`;
    const [
      remotesOutput,
      upstreamOutput,
      localIdentity,
      remoteRefsOutput,
      shallowOutput,
      objectGraphConfig,
      missingOutput,
      endpointConfig,
      fetchConfig,
    ] = await Promise.all([
      this.git.run(cwd, ['remote']),
      this.git.run(cwd, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', localTargetRef]),
      this.git.run(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads']),
      this.git.run(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)']),
      this.git.run(cwd, ['rev-parse', '--is-shallow-repository']),
      this.git.run(cwd, ['config', '--null', '--get-regexp', OBJECT_GRAPH_CONFIG_PATTERN]),
      this.git.run(cwd, ['rev-list', '--objects', '--all', '--missing=print']),
      this.git.run(cwd, ['config', '--show-origin', '--show-scope', '--null', '--get-regexp', CONFIG_INPUT_PATTERN]),
      this.git.run(cwd, ['config', '--null', '--get-regexp', FETCH_PATTERN]),
    ]);
    const remotes = requireRead(remotesOutput, '無法列出 Git remotes。')
      .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    requireRead(upstreamOutput, '無法讀取本地分支 upstream。');
    requireRead(localIdentity, '無法建立本地分支身分租約。');
    requireRead(remoteRefsOutput, '無法建立 remote-tracking ref 租約。');
    requireRead(shallowOutput, '無法判斷 repository 是否為 shallow。');
    if (missingOutput.code !== 0) throw new Error('無法驗證 repository object graph。');
    const [upstreamRemote = '', upstreamRef = ''] = upstreamOutput.stdout.trim().split('\0');
    const candidates = new Map<string, { remote: string; branch: string; preselected: boolean }>();
    for (const remote of remotes) {
      candidates.set(`${remote}\0${branch}`, { remote, branch, preselected: false });
    }
    if (remotes.includes(upstreamRemote) && upstreamRef.startsWith('refs/heads/')) {
      const upstreamBranch = upstreamRef.slice('refs/heads/'.length);
      const key = `${upstreamRemote}\0${upstreamBranch}`;
      candidates.set(key, { remote: upstreamRemote, branch: upstreamBranch, preselected: true });
    }

    const endpointsById = new Map<string, InternalEndpoint>();
    for (const candidate of [...candidates.values()].sort((a, b) =>
      `${a.remote}\0${a.branch}`.localeCompare(`${b.remote}\0${b.branch}`),
    )) {
      const urls = await this.git.run(cwd, ['remote', 'get-url', '--push', '--all', candidate.remote]);
      if (urls.code !== 0) continue;
      for (const rawEndpoint of uniqueSorted(urls.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))) {
        const ref = `refs/heads/${candidate.branch}`;
        const fingerprint = endpointFingerprint(rawEndpoint);
        const id = endpointLeaseId(candidate.remote, candidate.branch, fingerprint);
        const advertised = await this.git.network(cwd, [
          'ls-remote', '--refs', '--upload-pack=git-receive-pack', '--', rawEndpoint, ref,
        ]);
        const expectedOid = advertised.code === 0 ? parseAdvertisedOid(advertised.stdout, ref) : null;
        const endpoint: InternalEndpoint = {
          id,
          remote: candidate.remote,
          branch: candidate.branch,
          ref,
          rawEndpoint,
          fingerprint,
          display: endpointDisplay(rawEndpoint),
          status: expectedOid ? 'exists' : 'unknown',
          ...(expectedOid
            ? { expectedOid }
            : { reason: advertised.code === 0
              ? 'receive-pack 未公告精確 ref，無法區分不存在、隱藏或權限不足。'
              : 'receive-pack 查詢失敗，遠端狀態未知。' }),
          preselected: candidate.preselected && expectedOid !== null,
        };
        const previous = endpointsById.get(id);
        if (!previous || (previous.status === 'unknown' && endpoint.status === 'exists')) endpointsById.set(id, endpoint);
      }
    }
    const internalEndpoints = [...endpointsById.values()].sort((a, b) => a.id.localeCompare(b.id));
    const fetchRecords = parseFetchRefspecConfig(fetchConfig.stdout);
    const targetPairs = [...new Map(internalEndpoints.map((endpoint) => [
      `${endpoint.remote}\0${endpoint.branch}`,
      { remote: endpoint.remote, branch: endpoint.branch },
    ])).values()];
    const remoteRefStates = parseRefStates(remoteRefsOutput.stdout);
    const trackingRefs: RemoteTrackingLease[] = [];
    for (const analysis of analyzeTrackingRefs(fetchRecords, targetPairs)) {
      const refState = remoteRefStates.find((state) => state.ref === analysis.localRef && !state.symref);
      const producers = analysis.producers.map((producer) => ({
        ...producer,
        endpointIds: internalEndpoints
          .filter((endpoint) => endpoint.remote === producer.remote && endpoint.ref === producer.sourceRef)
          .map((endpoint) => endpoint.id),
      }));
      const symrefs = remoteRefStates
        .filter((state) => state.symref === analysis.localRef)
        .map((state) => ({
          ref: state.ref,
          target: state.symref,
          typical: producers.some((producer) => state.ref === `refs/remotes/${producer.remote}/HEAD`),
        }))
        .sort((a, b) => a.ref.localeCompare(b.ref));
      const reflog = await this.readReflog(cwd, analysis.localRef);
      trackingRefs.push({
        ...analysis,
        producers,
        ...(refState?.oid ? { expectedOid: refState.oid } : {}),
        symrefs,
        reflogExists: reflog.exists,
        reflogDigest: reflog.digest,
      });
    }

    const objectGraphReason = this.objectGraphReason(shallowOutput, objectGraphConfig, missingOutput);
    const token = randomUUID();
    const publicPlan: RemoteCleanupPlan = {
      token,
      branch,
      localTargetRef,
      objectGraphComplete: objectGraphReason === undefined,
      ...(objectGraphReason ? { objectGraphReason } : {}),
      localIdentityDigest: localIdentityDigest(localIdentity),
      localIdentityAfterTargetDeleteDigest: localIdentityDigest(localIdentity, localTargetRef),
      endpointConfigDigest: outputDigest(endpointConfig),
      refspecDigest: canonicalRefspecDigest(fetchRecords),
      conflictDigest: await this.guard.snapshot(cwd),
      endpoints: internalEndpoints.map(({ rawEndpoint: _rawEndpoint, ...endpoint }) => endpoint),
      trackingRefs,
    };
    this.rememberPlan(token, { publicPlan, endpoints: internalEndpoints });
    return publicPlan;
  }

  /**
   * 程序重啟後只從 journal 的去密 plan 恢復。此步只讀本機 Git config，不連線；
   * raw endpoint 以 effective URL 重新解析並必須唯一對回原 fingerprint。
   */
  async resume(cwd: string, plan: RemoteCleanupPlan): Promise<void> {
    if (!validateRef(plan.branch) || !plan.localTargetRef.startsWith('refs/heads/')
      || !validateRef(plan.localTargetRef.slice('refs/heads/'.length)) || !plan.token || plan.endpoints.length === 0) {
      throw new Error('遠端清理 receipt 不完整，無法恢復。');
    }
    const byRemote = new Map<string, string[]>();
    for (const remote of uniqueSorted(plan.endpoints.map((endpoint) => endpoint.remote))) {
      const urls = await this.git.run(cwd, ['remote', 'get-url', '--push', '--all', remote]);
      if (urls.code !== 0) throw new Error('無法從當下 Git config 重新解析 effective push endpoint。');
      byRemote.set(remote, uniqueSorted(urls.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)));
    }
    const endpoints: InternalEndpoint[] = plan.endpoints.map((endpoint) => {
      const matches = (byRemote.get(endpoint.remote) ?? []).filter((rawEndpoint) =>
        endpointLeaseId(endpoint.remote, endpoint.branch, endpointFingerprint(rawEndpoint)) === endpoint.id
        && endpointFingerprint(rawEndpoint) === endpoint.fingerprint,
      );
      if (matches.length !== 1) {
        throw new Error('effective push endpoint 無法唯一對回 receipt，必須重新確認。');
      }
      return { ...endpoint, rawEndpoint: matches[0] as string };
    });
    this.rememberPlan(plan.token, { publicPlan: plan, endpoints });
  }

  async execute(
    cwd: string,
    request: RemoteCleanupExecuteRequest,
    journal: RemoteCleanupJournal,
  ): Promise<RemoteCleanupResult> {
    const internal = this.plans.get(request.token);
    if (!internal) throw new Error('遠端清理租約已過期，請重新檢查。');
    const plan = internal.publicPlan;
    const knownIds = new Set(internal.endpoints.map((endpoint) => endpoint.id));
    const knownTrackingRefs = new Set(plan.trackingRefs.map((lease) => lease.localRef));
    const selected = new Set(request.selectedEndpointIds);
    const completed = new Set(request.completedEndpointIds ?? []);
    const completedTracking = new Set(request.completedTrackingRefs ?? []);
    const permanentlyRetainedTracking = new Set(request.permanentlyRetainedTrackingRefs ?? []);
    if ([...selected, ...completed].some((id) => !knownIds.has(id)) || [...completed].some((id) => !selected.has(id))) {
      throw new Error('遠端清理選擇與 journal checkpoint 不屬於這份租約。');
    }
    if ([...completedTracking, ...permanentlyRetainedTracking].some((ref) => !knownTrackingRefs.has(ref))) {
      throw new Error('tracking ref checkpoint 不屬於這份租約。');
    }
    if (!plan.objectGraphComplete && selected.size > 0) {
      throw new Error('repository 歷史不完整，遠端刪除已停用；本機清理仍可單獨進行。');
    }

    const results: RemoteEndpointResult[] = [];
    const success = new Set<string>();
    for (const endpoint of internal.endpoints) {
      const base = {
        id: endpoint.id,
        fingerprint: endpoint.fingerprint,
        remote: endpoint.remote,
        branch: endpoint.branch,
      };
      if (!selected.has(endpoint.id)) {
        results.push({ ...base, status: 'skipped' });
        continue;
      }
      if (endpoint.status !== 'exists' || !endpoint.expectedOid) {
        results.push({ ...base, status: 'unknown', message: endpoint.reason });
        continue;
      }
      const localLease = await this.verifyLocalLease(cwd, internal, endpoint, request.ownClaimId);
      if (localLease) {
        results.push({ ...base, status: 'stale', message: localLease });
        continue;
      }
      if (completed.has(endpoint.id)) {
        success.add(endpoint.id);
        results.push({ ...base, status: 'already-completed' });
        continue;
      }
      const advertised = await this.git.network(cwd, [
        'ls-remote', '--refs', '--upload-pack=git-receive-pack', '--', endpoint.rawEndpoint, endpoint.ref,
      ]);
      if (advertised.code !== 0) {
        results.push({ ...base, status: 'unknown', message: redactRemoteError(advertised.stderr, endpoint.rawEndpoint) });
        continue;
      }
      const oid = parseAdvertisedOid(advertised.stdout, endpoint.ref);
      if (!oid) {
        results.push({ ...base, status: 'unknown', message: 'receive-pack 未公告精確 ref；不能把不可見當成不存在。' });
        continue;
      }
      if (oid !== endpoint.expectedOid) {
        results.push({ ...base, status: 'stale', message: '遠端 tip 已變更，未刪除新 commit。' });
        continue;
      }
      const pushed = await this.git.network(cwd, [
        'push', '--porcelain',
        `--force-with-lease=${endpoint.ref}:${endpoint.expectedOid}`,
        '--', endpoint.rawEndpoint, `:${endpoint.ref}`,
      ]);
      if (!pushDeletedExactRef(pushed, endpoint.ref)) {
        const message = redactRemoteError(`${pushed.stderr}\n${pushed.stdout}`.trim(), endpoint.rawEndpoint);
        results.push({
          ...base,
          status: /stale info|fetch first|non-fast-forward/i.test(message) ? 'stale' : 'unknown',
          message: message || 'receive-pack 未回報精確 ref 已刪除。',
        });
        continue;
      }
      success.add(endpoint.id);
      results.push({ ...base, status: 'deleted' });
      await journal.checkpoint({ kind: 'endpoint-deleted', endpointId: endpoint.id, branch: endpoint.branch });
    }

    const tracking = await this.cleanupTrackingRefs(
      cwd,
      internal,
      selected,
      success,
      completedTracking,
      permanentlyRetainedTracking,
      request.ownClaimId,
      journal,
    );
    const remoteOk = results.every((result) =>
      result.status === 'deleted' || result.status === 'already-completed' || result.status === 'skipped',
    );
    const result = {
      ok: remoteOk && tracking.ok,
      endpoints: results,
      trackingRefsDeleted: tracking.deleted,
      trackingRefsRetained: tracking.retained,
    };
    if (result.ok) this.plans.delete(request.token);
    return result;
  }

  private async verifyLocalLease(
    cwd: string,
    internal: InternalPlan,
    endpoint: InternalEndpoint,
    ownClaimId?: string,
  ): Promise<string | null> {
    const [urls, localIdentity, endpointConfig, fetchConfig, conflictDigest] = await Promise.all([
      this.git.run(cwd, ['remote', 'get-url', '--push', '--all', endpoint.remote]),
      this.git.run(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads']),
      this.git.run(cwd, ['config', '--show-origin', '--show-scope', '--null', '--get-regexp', CONFIG_INPUT_PATTERN]),
      this.git.run(cwd, ['config', '--null', '--get-regexp', FETCH_PATTERN]),
      this.guard.snapshot(cwd, ownClaimId),
    ]);
    if (urls.code !== 0 || localIdentity.code !== 0) return '無法重驗本地分支或 effective push endpoint。';
    const plan = internal.publicPlan;
    const currentIds = urls.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
      .map((raw) => endpointLeaseId(endpoint.remote, endpoint.branch, endpointFingerprint(raw)));
    const records = parseFetchRefspecConfig(fetchConfig.stdout);
    const currentLocalIdentityDigest = localIdentityDigest(localIdentity);
    if (!currentIds.includes(endpoint.id)
      || (currentLocalIdentityDigest !== plan.localIdentityDigest
        && currentLocalIdentityDigest !== plan.localIdentityAfterTargetDeleteDigest)
      || outputDigest(endpointConfig) !== plan.endpointConfigDigest
      || canonicalRefspecDigest(records) !== plan.refspecDigest
      || conflictDigest !== plan.conflictDigest) {
      return '本地分支/upstream、endpoint、refspec 或 cleanup claim 已變更，必須重新確認。';
    }
    return null;
  }

  private async cleanupTrackingRefs(
    cwd: string,
    internal: InternalPlan,
    selected: Set<string>,
    success: Set<string>,
    completedTracking: Set<string>,
    permanentlyRetainedTracking: Set<string>,
    ownClaimId: string | undefined,
    journal: RemoteCleanupJournal,
  ): Promise<{ ok: boolean; deleted: string[]; retained: { localRef: string; reason: string }[] }> {
    const deleted: string[] = [];
    const retained: { localRef: string; reason: string }[] = [];
    let ok = true;
    for (const lease of internal.publicPlan.trackingRefs) {
      const belongsToSelectedTarget = lease.producers.some((producer) =>
        producer.endpointIds.some((endpointId) => selected.has(endpointId)),
      );
      if (!belongsToSelectedTarget) continue;
      if (permanentlyRetainedTracking.has(lease.localRef)) {
        retained.push({ localRef: lease.localRef, reason: 'remote-only receipt 已永久標示保留此本機 ref。' });
        continue;
      }
      if (completedTracking.has(lease.localRef)) {
        const representativeEndpoint = internal.endpoints.find((endpoint) => lease.producers.some((producer) =>
          producer.endpointIds.includes(endpoint.id),
        ));
        const stale = representativeEndpoint
          ? await this.verifyLocalLease(cwd, internal, representativeEndpoint, ownClaimId)
          : '找不到 tracking producer endpoint。';
        if (stale) {
          retained.push({ localRef: lease.localRef, reason: stale });
          ok = false;
        } else {
          deleted.push(lease.localRef);
        }
        continue;
      }
      let reason: string | undefined;
      if (!lease.namespaceAllowed) reason = 'ref 不在 refs/remotes/*，不自動刪除。';
      else if (lease.negativeOrAmbiguous) reason = 'refspec 有重疊、負向或無法唯一解釋的 producer。';
      else if (!lease.expectedOid) reason = '本機沒有可用 CAS 驗證的 tracking ref。';
      else if (lease.producers.some((producer) => producer.endpointIds.length === 0)) reason = 'producer 沒有可證明缺席的 effective push endpoint。';
      else if (lease.producers.some((producer) => producer.endpointIds.some((id) => !selected.has(id) || !success.has(id)))) {
        retained.push({ localRef: lease.localRef, reason: '並非所有 producer endpoint 都已明確選取並完成。' });
        ok = false;
        continue;
      } else if (lease.symrefs.some((symref) => !symref.typical)) {
        reason = '存在非典型 symref 指向此 tracking ref。';
      }
      if (reason) {
        retained.push({ localRef: lease.localRef, reason });
        await journal.checkpoint({ kind: 'tracking-retained', localRef: lease.localRef, reason });
        continue;
      }

      const representativeEndpoint = internal.endpoints.find((endpoint) => lease.producers.some((producer) =>
        producer.endpointIds.includes(endpoint.id),
      ));
      if (!representativeEndpoint) continue;
      const localLease = await this.verifyLocalLease(cwd, internal, representativeEndpoint, ownClaimId);
      const remoteRefs = await this.git.run(cwd, [
        'for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)',
      ]);
      const reflog = await this.readReflog(cwd, lease.localRef);
      const states = parseRefStates(remoteRefs.stdout);
      const refState = states.find((state) => state.ref === lease.localRef && !state.symref);
      const symrefs = states.filter((state) => state.symref === lease.localRef)
        .map((state) => ({ ref: state.ref, target: state.symref }))
        .sort((a, b) => a.ref.localeCompare(b.ref));
      const expectedSymrefs = lease.symrefs.map(({ ref, target }) => ({ ref, target }));
      if (localLease || remoteRefs.code !== 0 || refState?.oid !== lease.expectedOid
        || digest(symrefs) !== digest(expectedSymrefs)
        || reflog.exists !== lease.reflogExists || reflog.digest !== lease.reflogDigest) {
        reason = localLease ?? 'tracking ref、reflog 或 symref expected-state 已變更。';
        retained.push({ localRef: lease.localRef, reason });
        ok = false;
        await journal.checkpoint({ kind: 'tracking-retained', localRef: lease.localRef, reason });
        continue;
      }

      const transaction = [
        'start',
        ...lease.symrefs.flatMap((symref) => ['option no-deref', `symref-delete ${symref.ref} ${symref.target}`]),
        'option no-deref',
        `delete ${lease.localRef} ${lease.expectedOid}`,
        'prepare',
        'commit',
        '',
      ].join('\n');
      const removed = await this.git.write(
        cwd,
        ['update-ref', '--stdin', '-m', `polydesk-remote-cleanup:${internal.publicPlan.token}`],
        transaction,
      );
      const refAfter = await this.git.run(cwd, ['show-ref', '--verify', lease.localRef]);
      const reflogAfter = await this.readReflog(cwd, lease.localRef);
      const refsAfter = await this.git.run(cwd, [
        'for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)',
      ]);
      const residualSymrefs = parseRefStates(refsAfter.stdout).filter((state) => state.symref === lease.localRef);
      if (removed.code !== 0 || refAfter.code === 0 || reflogAfter.exists || refsAfter.code !== 0 || residualSymrefs.length > 0) {
        if (removed.code === 0 && refAfter.code !== 0 && residualSymrefs.length > 0) {
          await this.git.write(
            cwd,
            ['update-ref', '--stdin', '-m', `polydesk-remote-cleanup-restore:${internal.publicPlan.token}`],
            `start\ncreate ${lease.localRef} ${lease.expectedOid}\nprepare\ncommit\n`,
          );
        }
        reason = removed.code === 0
          ? 'tracking ref 已處理但 reflog/metadata 尚未完整收斂。'
          : 'tracking ref CAS transaction 發生競態，已保留。';
        retained.push({ localRef: lease.localRef, reason });
        ok = false;
        await journal.checkpoint({ kind: 'tracking-retained', localRef: lease.localRef, reason });
        continue;
      }
      deleted.push(lease.localRef);
      await journal.checkpoint({ kind: 'tracking-deleted', localRef: lease.localRef });
    }
    return { ok, deleted, retained };
  }

  private async readReflog(cwd: string, ref: string): Promise<{ exists: boolean; digest: string }> {
    const exists = await this.git.run(cwd, ['reflog', 'exists', ref]);
    if (exists.code !== 0) return { exists: false, digest: digest('absent') };
    const content = await this.git.run(cwd, ['reflog', 'show', '--format=%H%x00%gD%x00%gs', ref]);
    return content.code === 0
      ? { exists: true, digest: digest(content.stdout) }
      : { exists: true, digest: digest('unreadable') };
  }

  private objectGraphReason(shallow: RemoteGitOutput, config: RemoteGitOutput, missing: RemoteGitOutput): string | undefined {
    if (shallow.stdout.trim() !== 'false') return 'shallow repository 的完整遠端歷史未知。';
    if (config.code === 0 && config.stdout.trim()) return 'partial clone/promisor repository 的完整遠端歷史未知。';
    if (missing.code !== 0 || missing.stdout.split(/\r?\n/).some((line) => line.startsWith('?'))) {
      return 'repository 有缺失或無法走訪的 Git objects。';
    }
    return undefined;
  }
}
