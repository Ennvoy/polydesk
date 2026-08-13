import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import type {
  GitCleanupBlocker,
  GitCleanupMetadataEntry,
  GitCleanupPreviewRequest,
  GitCleanupPreviewResult,
  GitCleanupRefLease,
  GitCleanupSnapshot,
  GitCleanupWorktreeSnapshot,
} from '../../../../shared/gitCleanup';
import { validateRef } from '../../gitSafeArgs';
import { CleanupGitRunner } from './CleanupGitRunner';
import { digest, sha256 } from './hash';

const OPERATION_MARKERS = [
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['REBASE_HEAD', 'rebase'],
  ['BISECT_START', 'bisect'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase/apply'],
  ['sequencer', 'sequencer'],
  ['AM_HEAD', 'am'],
  ['AUTO_MERGE', 'auto-merge'],
] as const;

interface RawWorktree {
  path: string;
  head: string;
  branch: string | null;
  prunable: boolean;
  locked: boolean;
  lockReason?: string;
  isMain: boolean;
}

function parseWorktrees(raw: string): RawWorktree[] {
  const records: string[][] = [];
  let current: string[] = [];
  for (const token of raw.split('\0')) {
    if (token === '') {
      if (current.length > 0) records.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) records.push(current);
  return records.flatMap((record, index) => {
    let path = '';
    let head = '';
    let branch: string | null = null;
    let prunable = false;
    let locked = false;
    let lockReason: string | undefined;
    for (const line of record) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
      else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length);
      else if (line === 'detached') branch = null;
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
      else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true;
        lockReason = line.slice('locked'.length).trim() || undefined;
      }
    }
    return path ? [{ path, head, branch, prunable, locked, lockReason, isMain: index === 0 }] : [];
  });
}

function parseRefs(raw: string, scopePath?: string): GitCleanupRefLease[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    const [ref = '', oid = '', objectType = '', symref = ''] = line.split('\0');
    return ref && oid ? [{ ref, oid, objectType, symref, ...(scopePath ? { scopePath } : {}) }] : [];
  });
}

function sortRefLeases(refs: GitCleanupRefLease[]): GitCleanupRefLease[] {
  return refs.sort((a, b) =>
    (a.scopePath ?? '').localeCompare(b.scopePath ?? '') ||
    a.ref.localeCompare(b.ref) ||
    a.oid.localeCompare(b.oid) ||
    (a.objectType ?? '').localeCompare(b.objectType ?? '') ||
    (a.symref ?? '').localeCompare(b.symref ?? ''),
  );
}

function parseMetadata(raw: string): GitCleanupMetadataEntry[] {
  const tokens = raw.split('\0');
  const entries: GitCleanupMetadataEntry[] = [];
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    const scope = tokens[index] ?? '';
    const origin = tokens[index + 1] ?? '';
    const keyValue = tokens[index + 2] ?? '';
    const split = keyValue.indexOf('\n');
    const key = split >= 0 ? keyValue.slice(0, split) : keyValue;
    const value = split >= 0 ? keyValue.slice(split + 1) : '';
    if (!key) continue;
    const mutable = scope === 'local' && (origin.startsWith('file:.git/') || /config(?:\.worktree)?$/i.test(origin));
    entries.push({ scope, origin, key, value, mutable });
  }
  return entries;
}

function statExists(path: string): boolean | null {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return null;
  }
}

export class CleanupPreviewService {
  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly git = new CleanupGitRunner(),
  ) {}

  async resolveCommonDir(wsId: string): Promise<string | null> {
    const workspace = this.workspaces.get(wsId);
    if (!workspace) return null;
    const result = await this.git.run(workspace.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'], true);
    return result.code === 0 && result.stdout.trim() ? resolve(result.stdout.trim()) : null;
  }

  async preview(request: GitCleanupPreviewRequest): Promise<GitCleanupPreviewResult> {
    if (!validateRef(request.branch)) return { ok: false, error: '無效的本地分支名稱。', code: 'invalid-branch' };
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。', code: 'repository-identity-unknown' };
    const cwd = workspace.path;
    const targetRef = `refs/heads/${request.branch}`;
    const targetResult = await this.git.run(cwd, ['rev-parse', '--verify', `${targetRef}^{commit}`], true);
    if (targetResult.code !== 0) return { ok: false, error: '找不到要清理的本地分支。', code: 'branch-not-found' };
    const target: GitCleanupRefLease = { ref: targetRef, oid: targetResult.stdout.trim() };

    const commonDir = await this.resolveCommonDir(request.wsId);
    if (!commonDir) {
      return { ok: false, error: '無法確認 repository 身分。', code: 'repository-identity-unknown' };
    }
    const repositoryFingerprint = sha256(process.platform === 'win32' ? commonDir.toLowerCase() : commonDir);

    const worktreeOutput = await this.git.run(cwd, ['worktree', 'list', '--porcelain', '-z']);
    const rawWorktrees = parseWorktrees(worktreeOutput.stdout);
    const main = rawWorktrees.find((worktree) => worktree.isMain);
    const upstream = await this.git.run(cwd, ['for-each-ref', '--format=%(upstream)%00%(upstream:short)%00', targetRef]);
    const [upstreamRef = ''] = upstream.stdout.split('\0');
    const baselineRef = upstreamRef || (request.switchTo ? `refs/heads/${request.switchTo}` : main?.branch ? `refs/heads/${main.branch}` : '');
    if (!baselineRef || !baselineRef.startsWith('refs/')) {
      return { ok: false, error: '找不到可驗證的具名安全基準。', code: 'baseline-unavailable' };
    }
    const baselineResult = await this.git.run(cwd, ['rev-parse', '--verify', `${baselineRef}^{commit}`], true);
    if (baselineResult.code !== 0) return { ok: false, error: '安全基準已不存在。', code: 'baseline-unavailable' };
    const baseline: GitCleanupRefLease = { ref: baselineRef, oid: baselineResult.stdout.trim() };

    const blockers: GitCleanupBlocker[] = [];
    const worktrees: GitCleanupWorktreeSnapshot[] = [];
    let privateRefsCapable = true;
    let markerCapable = true;
    const retainedByName = new Map<string, GitCleanupRefLease>();
    const commonRefs = await this.git.run(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)']);
    for (const ref of parseRefs(commonRefs.stdout)) {
      if (ref.ref !== targetRef) retainedByName.set(ref.ref, ref);
    }

    const removedWorktreeIds = new Set(request.removeWorktreeIds ?? []);
    const retainedPrivateScopes: string[] = [];
    for (const worktree of rawWorktrees) {
      const worktreeId = sha256(`${repositoryFingerprint}\0${worktree.path}`);
      let statusDigest: string | null = null;
      let dirty: boolean | null = null;
      let gitDirDigest: string | null = null;
      let privateRefsDigest: string | null = null;
      const operations = new Set<string>();
      if (!worktree.prunable) {
        const [status, submodules, gitDir, markerPaths, privateRefs] = await Promise.all([
          this.git.run(worktree.path, ['status', '--porcelain=v2', '--untracked-files=all', '--ignored=matching', '-z'], true),
          this.git.run(worktree.path, ['submodule', 'status', '--recursive'], true),
          this.git.run(worktree.path, ['rev-parse', '--path-format=absolute', '--git-dir'], true),
          this.git.run(worktree.path, ['rev-parse', '--path-format=absolute', ...OPERATION_MARKERS.flatMap(([marker]) => ['--git-path', marker])], true),
          this.git.run(worktree.path, [
            'for-each-ref',
            '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)',
            'refs/bisect',
            'refs/worktree',
            'refs/rewritten',
          ], true),
        ]);
        if (status.code === 0 && submodules.code === 0) {
          statusDigest = digest([status.stdout, submodules.stdout]);
          dirty = status.stdout.length > 0 || submodules.stdout.split(/\r?\n/).some((line) => line.trim() && !line.startsWith(' '));
        }
        else blockers.push({ code: 'worktree-state-unknown', message: `無法讀取 worktree 狀態：${worktree.path}`, worktreeId });

        if (gitDir.code === 0 && gitDir.stdout.trim()) gitDirDigest = sha256(resolve(gitDir.stdout.trim()));
        else blockers.push({ code: 'worktree-state-unknown', message: `無法解析 worktree Git 目錄：${worktree.path}`, worktreeId });

        const resolvedMarkers = markerPaths.stdout.split(/\r?\n/).filter(Boolean);
        for (let index = 0; index < OPERATION_MARKERS.length; index += 1) {
          const [, operation] = OPERATION_MARKERS[index] as (typeof OPERATION_MARKERS)[number];
          const markerPath = resolvedMarkers[index];
          if (markerPaths.code !== 0 || !markerPath) {
            markerCapable = false;
            blockers.push({ code: 'operation-state-unknown', message: `無法檢查 ${operation} 狀態：${worktree.path}`, worktreeId });
            continue;
          }
          const present = statExists(markerPath);
          if (present === true) operations.add(operation);
          if (present === null) {
            markerCapable = false;
            blockers.push({ code: 'operation-state-unknown', message: `無法讀取 ${operation} marker：${worktree.path}`, worktreeId });
          }
        }
        if (operations.size > 0) {
          blockers.push({ code: 'operation-in-progress', message: `worktree 有未完成 Git 操作：${[...operations].join('、')}`, worktreeId });
        }

        if (privateRefs.code === 0) {
          const parsed = parseRefs(privateRefs.stdout, worktree.path);
          privateRefsDigest = digest(parsed);
          if (!removedWorktreeIds.has(worktreeId)) {
            retainedPrivateScopes.push(worktree.path);
            for (const ref of parsed) retainedByName.set(`${worktreeId}:${ref.ref}`, ref);
          }
        } else {
          privateRefsCapable = false;
          blockers.push({ code: 'private-refs-unknown', message: `無法列舉 worktree 私有 refs：${worktree.path}`, worktreeId });
        }
      }
      worktrees.push({
        id: worktreeId,
        displayPath: worktree.path,
        branch: worktree.branch,
        head: worktree.head,
        isMain: worktree.isMain,
        prunable: worktree.prunable,
        locked: worktree.locked,
        ...(worktree.lockReason ? { lockReason: worktree.lockReason } : {}),
        statusDigest,
        dirty,
        gitDirDigest,
        operations: [...operations].sort(),
        privateRefsDigest,
      });
    }

    const escapedBranch = request.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [metadataResult, reflogExistsResult, shallowResult, promisorResult, objectsResult, reflogHelp, branches, bareResult] = await Promise.all([
      this.git.run(cwd, [
        'config',
        '--show-origin',
        '--show-scope',
        '--null',
        '--get-regexp',
        `^branch\\.${escapedBranch}\\.`,
      ], true),
      this.git.run(cwd, ['reflog', 'exists', targetRef], true),
      this.git.run(cwd, ['rev-parse', '--is-shallow-repository'], true),
      this.git.run(cwd, ['config', '--get-regexp', '^remote\\..*\\.promisor$'], true),
      this.git.run(cwd, ['rev-list', '--objects', '--all', '--missing=print'], true),
      this.git.run(cwd, ['reflog', '-h'], true),
      this.git.run(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      this.git.run(cwd, ['rev-parse', '--is-bare-repository']),
    ]);
    const metadataEntries = metadataResult.code === 0 ? parseMetadata(metadataResult.stdout) : [];
    for (const entry of metadataEntries) {
      if (!entry.mutable) blockers.push({ code: 'metadata-origin-unsupported', message: `分支設定來自不可自動修改的來源：${entry.origin}` });
    }
    const reflogResult = reflogExistsResult.code === 0
      ? await this.git.run(cwd, ['reflog', 'show', '--format=%H%x00%gD%x00%gs', '-z', targetRef], true)
      : { code: 1, stdout: '', stderr: '' };

    const shallow = shallowResult.code !== 0 || shallowResult.stdout.trim() !== 'false';
    const promisor = promisorResult.code === 0 && promisorResult.stdout.trim().length > 0;
    const missingObjectCount = objectsResult.stdout.split(/\r?\n/).filter((line) => line.startsWith('?')).length;
    const objectGraphComplete = objectsResult.code === 0 && !shallow && !promisor && missingObjectCount === 0;
    if (!objectGraphComplete) blockers.push({ code: 'object-graph-incomplete', message: 'repository object graph 不完整，風險數量只能視為未知。' });

    const reflogDrop = /\breflog drop\b/.test(`${reflogHelp.stdout}\n${reflogHelp.stderr}`);
    if (!reflogDrop) blockers.push({ code: 'reflog-drop-unsupported', message: '目前 Git 不支援完整移除單一分支 reflog。' });

    const occupied = new Set(rawWorktrees.map((worktree) => worktree.branch).filter((branch): branch is string => branch !== null));
    const switchCandidates = branches.stdout.split(/\r?\n/).map((branch) => branch.trim()).filter((branch) => branch && branch !== request.branch && !occupied.has(branch));
    const retainedRefs = sortRefLeases([...retainedByName.values()]);
    retainedPrivateScopes.sort((a, b) => a.localeCompare(b));
    const [safeDeleteResult, lostCountResult] = await Promise.all([
      this.git.run(cwd, ['merge-base', '--is-ancestor', target.oid, baseline.oid], true),
      this.git.run(cwd, ['rev-list', '--count', target.oid, ...(retainedRefs.length > 0 ? ['--not', ...retainedRefs.map((ref) => ref.oid)] : [])], true),
    ]);
    const safeDelete = safeDeleteResult.code === 0;
    const lostCommitCount = lostCountResult.code === 0 ? Number.parseInt(lostCountResult.stdout.trim(), 10) || 0 : 0;
    const repositoryEvidence = {
      bare: bareResult.stdout.trim(),
      head: main?.head ?? '',
      target,
    };
    const snapshot: GitCleanupSnapshot = {
      repository: {
        fingerprint: repositoryFingerprint,
        commonDirDigest: sha256(commonDir),
        evidenceDigest: digest(repositoryEvidence),
      },
      target,
      baseline,
      retainedRefs: {
        count: retainedRefs.length,
        digest: digest({ refs: retainedRefs, privateScopes: retainedPrivateScopes }),
        refs: retainedRefs,
        privateScopes: retainedPrivateScopes,
      },
      worktrees,
      metadata: {
        digest: digest(metadataEntries),
        entries: metadataEntries,
        reflogDigest: digest(reflogResult.stdout),
        reflogExists: reflogExistsResult.code === 0,
      },
      objectGraph: { complete: objectGraphComplete, shallow, promisor, missingObjectCount },
      localRisk: { safeDelete, lostCommitCount, exact: objectGraphComplete && lostCountResult.code === 0 },
      capabilities: { reflogDrop, privateRefs: privateRefsCapable, operationMarkers: markerCapable },
      switchCandidates,
      blockers,
    };
    return { ok: true, snapshot, leaseToken: digest(snapshot) };
  }
}
