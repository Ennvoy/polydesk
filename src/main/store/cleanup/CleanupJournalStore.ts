import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { digest, sha256, stableJson } from '../../git/cleanup/core/hash';

const SCHEMA_VERSION = 1;

type JournalPhase = 'prepared' | 'mutating' | 'reconciling' | 'closed' | 'quarantine';

interface JournalEnvelopeBase {
  schemaVersion: number;
  journalId: string;
  repositoryFingerprint: string;
  repositoryGeneration: string;
  phase: JournalPhase;
  generation: number;
  createdAt: string;
  updatedAt: string;
  payloadChecksum: string;
  zeroSideEffect: boolean;
  archived: boolean;
}

interface JournalEnvelope extends JournalEnvelopeBase {
  envelopeChecksum: string;
}

interface Claim {
  journalId: string;
  repositoryFingerprint: string;
  repositoryGeneration: string;
  phase: Exclude<JournalPhase, 'closed'>;
  generation: number;
}

interface ClaimIndexBody {
  schemaVersion: number;
  generation: number;
  claims: Claim[];
  globalBlocked: boolean;
  issues: CleanupStoreIssue[];
}

interface ClaimIndex extends ClaimIndexBody {
  checksum: string;
}

interface IdentityEntry {
  fingerprint: string;
  generation: string;
  fileIdentity: string;
  evidenceDigest: string;
  updatedAt: string;
}

interface IdentityRegistryBody {
  schemaVersion: number;
  entries: IdentityEntry[];
}

interface IdentityRegistry extends IdentityRegistryBody {
  checksum: string;
}

export interface CleanupStoreIssue {
  code: string;
  message: string;
  file?: string;
}

export class CleanupStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CleanupStoreError';
  }
}

function withChecksum<T extends object>(body: T, field: 'checksum' | 'envelopeChecksum'): T & Record<typeof field, string> {
  return { ...body, [field]: digest(body) } as T & Record<typeof field, string>;
}

function verifyChecksum(value: Record<string, unknown>, field: 'checksum' | 'envelopeChecksum'): boolean {
  const actual = value[field];
  const body = { ...value };
  delete body[field];
  return typeof actual === 'string' && actual === digest(body);
}

export class CleanupJournalStore {
  private readonly root: string;
  private readonly activeDir: string;
  private readonly quarantineDir: string;
  private readonly archiveDir: string;
  private readonly claimsPath: string;
  private readonly identitiesPath: string;
  private readonly lockPath: string;

  constructor(userDataDir: string) {
    this.root = join(userDataDir, 'branch-cleanup');
    this.activeDir = join(this.root, 'active');
    this.quarantineDir = join(this.root, 'quarantine');
    this.archiveDir = join(this.root, 'archive');
    this.claimsPath = join(this.root, 'claims.json');
    this.identitiesPath = join(this.root, 'repository-identities.json');
    this.lockPath = join(this.root, 'claims.lock');
  }

  createPrepared(input: {
    repositoryFingerprint: string;
    repositoryGeneration: string;
    payload: unknown;
  }): JournalEnvelope {
    return this.withLock(() => {
      const rebuilt = this.rebuildClaimsUnsafe();
      if (rebuilt.globalBlocked) throw new CleanupStoreError('global-blocked', '清理儲存區存在無法歸屬的狀態。');
      if (rebuilt.claims.some((claim) =>
        claim.repositoryFingerprint === input.repositoryFingerprint
        || claim.repositoryGeneration === input.repositoryGeneration,
      )) {
        throw new CleanupStoreError('active-cleanup', '此 repository 已有未完成的本機清理。');
      }
      const journalId = randomUUID();
      const now = new Date().toISOString();
      const payloadChecksum = digest(input.payload);
      const envelope = withChecksum({
        schemaVersion: SCHEMA_VERSION,
        journalId,
        repositoryFingerprint: input.repositoryFingerprint,
        repositoryGeneration: input.repositoryGeneration,
        phase: 'prepared' as const,
        generation: 1,
        createdAt: now,
        updatedAt: now,
        payloadChecksum,
        zeroSideEffect: true,
        archived: false,
      }, 'envelopeChecksum');
      mkdirSync(this.activeDir, { recursive: true });
      this.atomicWriteJson(this.payloadPath(this.activeDir, journalId), input.payload);
      this.atomicWriteJson(this.envelopePath(this.activeDir, journalId), envelope);
      this.writeClaims(this.scanCanonicalClaims().claims);
      return envelope;
    });
  }

  markMutating(journalId: string): JournalEnvelope {
    return this.updateEnvelope(journalId, (current) => ({ ...current, phase: 'mutating', zeroSideEffect: false }));
  }

  markReconciling(journalId: string): JournalEnvelope {
    return this.updateEnvelope(journalId, (current) => ({ ...current, phase: 'reconciling', zeroSideEffect: false }));
  }

  checkpoint(journalId: string, checkpoint: string): JournalEnvelope {
    return this.withLock(() => {
      const path = this.envelopePath(this.activeDir, journalId);
      const current = this.readEnvelope(path);
      if (current.phase !== 'mutating' && current.phase !== 'reconciling') {
        throw new CleanupStoreError('invalid-phase', '只有 mutating/reconciling journal 可寫 checkpoint。');
      }
      const payloadPath = this.payloadPath(this.activeDir, journalId);
      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as Record<string, unknown>;
      if (digest(payload) !== current.payloadChecksum) {
        throw new CleanupStoreError('invalid-payload', 'journal payload checksum 已變更。');
      }
      const previous = Array.isArray(payload.checkpoints)
        ? payload.checkpoints.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const nextPayload = { ...payload, checkpoints: [...previous, checkpoint] };
      this.atomicWriteJson(payloadPath, nextPayload);
      const next = this.nextEnvelope(current, { payloadChecksum: digest(nextPayload), zeroSideEffect: false });
      this.atomicWriteJson(path, next);
      this.writeClaims(this.scanCanonicalClaims().claims);
      return next;
    });
  }

  downgradeMutatingToPrepared(journalId: string): JournalEnvelope {
    return this.updateEnvelope(journalId, (current) => {
      if (current.phase !== 'mutating') throw new CleanupStoreError('invalid-phase', 'journal 不在 mutating。');
      return { ...current, phase: 'prepared', zeroSideEffect: true };
    });
  }

  close(journalId: string): JournalEnvelope {
    return this.updateEnvelope(journalId, (current) => ({ ...current, phase: 'closed', zeroSideEffect: false }));
  }

  cancelPrepared(journalId: string): boolean {
    return this.withLock(() => {
      const envelope = this.readEnvelope(this.envelopePath(this.activeDir, journalId));
      if (envelope.phase !== 'prepared' || !envelope.zeroSideEffect) return false;
      const closed = this.nextEnvelope(envelope, { phase: 'closed' });
      this.atomicWriteJson(this.envelopePath(this.activeDir, journalId), closed);
      mkdirSync(this.archiveDir, { recursive: true });
      renameSync(this.envelopePath(this.activeDir, journalId), this.envelopePath(this.archiveDir, journalId));
      renameSync(this.payloadPath(this.activeDir, journalId), this.payloadPath(this.archiveDir, journalId));
      this.writeClaims(this.scanCanonicalClaims().claims);
      return true;
    });
  }

  rebuildClaims(): { globalBlocked: boolean; claims: Claim[]; issues: CleanupStoreIssue[] } {
    return this.withLock(() => this.rebuildClaimsUnsafe());
  }

  archiveQuarantine(journalId: string): { archived: boolean; claimReleased: boolean } {
    return this.withLock(() => {
      const path = this.envelopePath(this.quarantineDir, journalId);
      const envelope = this.readEnvelope(path);
      const archived = this.nextEnvelope(envelope, { archived: true });
      this.atomicWriteJson(path, archived);
      const rebuilt = this.rebuildClaimsUnsafe();
      return {
        archived: true,
        claimReleased: !rebuilt.claims.some((claim) => claim.journalId === journalId),
      };
    });
  }

  list(): { globalBlocked: boolean; claims: Claim[]; issues: CleanupStoreIssue[] } {
    return this.rebuildClaims();
  }

  /** SCM 輪詢專用唯讀 snapshot；repair/quarantine 只允許由啟動或明確寫入流程觸發。 */
  peek(): { globalBlocked: boolean; claims: Claim[]; issues: CleanupStoreIssue[] } {
    if (!existsSync(this.claimsPath)) {
      return {
        globalBlocked: true,
        claims: [],
        issues: [{ code: 'claim-index-uninitialized', message: 'cleanup claim index 尚未完成啟動重建。' }],
      };
    }
    try {
      const current = JSON.parse(readFileSync(this.claimsPath, 'utf8')) as ClaimIndex;
      if (current.schemaVersion !== SCHEMA_VERSION || !verifyChecksum(current as unknown as Record<string, unknown>, 'checksum')) {
        return {
          globalBlocked: true,
          claims: [],
          issues: [{ code: 'claim-index-invalid', message: 'claim index checksum 或 schema 無效。', file: basename(this.claimsPath) }],
        };
      }
      return {
        globalBlocked: current.globalBlocked,
        claims: current.claims.map((claim) => ({ ...claim })),
        issues: current.issues.map((issue) => ({ ...issue })),
      };
    } catch {
      return {
        globalBlocked: true,
        claims: [],
        issues: [{ code: 'claim-index-invalid', message: 'claim index 無法解析。', file: basename(this.claimsPath) }],
      };
    }
  }

  readPayload(journalId: string): unknown {
    for (const dir of [this.activeDir, this.quarantineDir, this.archiveDir]) {
      const path = this.payloadPath(dir, journalId);
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    }
    throw new CleanupStoreError('journal-not-found', '找不到清理 journal。');
  }

  readVerifiedActive(journalId: string): { envelope: JournalEnvelopeBase; payload: unknown } {
    const envelope = this.readEnvelope(this.envelopePath(this.activeDir, journalId));
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(this.payloadPath(this.activeDir, journalId), 'utf8')) as unknown;
    } catch {
      throw new CleanupStoreError('invalid-payload', 'journal payload 無法解析。');
    }
    if (digest(payload) !== envelope.payloadChecksum) {
      throw new CleanupStoreError('invalid-payload', 'journal payload checksum 已變更。');
    }
    return { envelope, payload };
  }

  rebindActiveJournal(input: {
    journalId: string;
    repositoryFingerprint: string;
    repositoryGeneration: string;
    payload: unknown;
  }): JournalEnvelopeBase {
    return this.withLock(() => {
      const rebuilt = this.rebuildClaimsUnsafe();
      if (rebuilt.globalBlocked) throw new CleanupStoreError('global-blocked', '清理儲存區存在無法歸屬的狀態。');
      if (rebuilt.claims.some((claim) => claim.journalId !== input.journalId && (
        claim.repositoryFingerprint === input.repositoryFingerprint
        || claim.repositoryGeneration === input.repositoryGeneration
      ))) {
        throw new CleanupStoreError('active-cleanup', '此 repository 已有另一份未完成的本機清理。');
      }
      const envelopePath = this.envelopePath(this.activeDir, input.journalId);
      const payloadPath = this.payloadPath(this.activeDir, input.journalId);
      const current = this.readEnvelope(envelopePath);
      let currentPayload: unknown;
      try {
        currentPayload = JSON.parse(readFileSync(payloadPath, 'utf8')) as unknown;
      } catch {
        throw new CleanupStoreError('invalid-payload', 'journal payload 無法解析。');
      }
      if (digest(currentPayload) !== current.payloadChecksum) {
        throw new CleanupStoreError('invalid-payload', 'journal payload checksum 已變更。');
      }
      if (current.repositoryGeneration !== input.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', 'journal 不屬於目前的 repository 實例。');
      }
      this.atomicWriteJson(payloadPath, input.payload);
      const next = this.nextEnvelope(current, {
        repositoryFingerprint: input.repositoryFingerprint,
        payloadChecksum: digest(input.payload),
      });
      this.atomicWriteJson(envelopePath, next);
      this.writeClaims(this.scanCanonicalClaims().claims);
      return next;
    });
  }

  readActiveEnvelope(journalId: string): JournalEnvelopeBase {
    return this.readEnvelope(this.envelopePath(this.activeDir, journalId));
  }

  readQuarantineEnvelope(journalId: string): JournalEnvelopeBase {
    return this.readEnvelope(this.envelopePath(this.quarantineDir, journalId));
  }

  restoreQuarantinedPayload(journalId: string, payload: unknown): void {
    this.withLock(() => {
      const quarantineEnvelopePath = this.envelopePath(this.quarantineDir, journalId);
      const envelope = this.readEnvelope(quarantineEnvelopePath);
      if (digest(payload) !== envelope.payloadChecksum) {
        throw new CleanupStoreError('evidence-mismatch', '匯入證據與原 journal checksum 不符。');
      }
      const restored = this.nextEnvelope(envelope, { phase: 'reconciling', zeroSideEffect: false, archived: false });
      mkdirSync(this.activeDir, { recursive: true });
      this.atomicWriteJson(this.payloadPath(this.activeDir, journalId), payload);
      this.atomicWriteJson(this.envelopePath(this.activeDir, journalId), restored);
      rmSync(this.payloadPath(this.quarantineDir, journalId), { force: true });
      rmSync(quarantineEnvelopePath, { force: true });
      this.writeClaims(this.scanCanonicalClaims().claims);
    });
  }

  resolveRepositoryIdentity(commonDir: string, evidenceDigest: string): { fingerprint: string; generation: string } {
    return this.withLock(() => {
      mkdirSync(this.root, { recursive: true });
      const canonical = resolve(commonDir);
      const fileIdentity = this.fileIdentity(canonical);
      const fingerprint = sha256(process.platform === 'win32' ? canonical.toLowerCase() : canonical);
      const registry = this.readIdentityRegistry();
      const sameInstance = registry.entries.find((entry) => entry.fileIdentity === fileIdentity && entry.evidenceDigest === evidenceDigest);
      if (sameInstance) {
        sameInstance.fingerprint = fingerprint;
        sameInstance.updatedAt = new Date().toISOString();
        this.writeIdentityRegistry(registry.entries);
        return { fingerprint, generation: sameInstance.generation };
      }
      const entry: IdentityEntry = {
        fingerprint,
        generation: randomUUID(),
        fileIdentity,
        evidenceDigest,
        updatedAt: new Date().toISOString(),
      };
      this.writeIdentityRegistry([...registry.entries, entry]);
      return { fingerprint, generation: entry.generation };
    });
  }

  /** SCM 輪詢只能讀取既有 identity registry，不得因狀態查詢改寫路徑或世代。 */
  repositoryGenerations(commonDir: string): string[] {
    const fileIdentity = this.fileIdentity(resolve(commonDir));
    return [...new Set(this.readIdentityRegistry().entries
      .filter((entry) => entry.fileIdentity === fileIdentity)
      .map((entry) => entry.generation))];
  }

  repositoryFingerprint(commonDir: string): string {
    const canonical = resolve(commonDir);
    return sha256(process.platform === 'win32' ? canonical.toLowerCase() : canonical);
  }

  private updateEnvelope(journalId: string, update: (current: JournalEnvelope) => JournalEnvelopeBase): JournalEnvelope {
    return this.withLock(() => {
      const path = this.envelopePath(this.activeDir, journalId);
      const current = this.readEnvelope(path);
      const next = this.nextEnvelope(current, update(current));
      this.atomicWriteJson(path, next);
      this.writeClaims(this.scanCanonicalClaims().claims);
      return next;
    });
  }

  private nextEnvelope(current: JournalEnvelope, changes: Partial<JournalEnvelopeBase>): JournalEnvelope {
    const body: JournalEnvelopeBase = {
      ...current,
      ...changes,
      generation: current.generation + 1,
      updatedAt: new Date().toISOString(),
    };
    const withoutChecksum = { ...body } as JournalEnvelopeBase & { envelopeChecksum?: string };
    delete withoutChecksum.envelopeChecksum;
    return withChecksum(withoutChecksum, 'envelopeChecksum');
  }

  private rebuildClaimsUnsafe(): { globalBlocked: boolean; claims: Claim[]; issues: CleanupStoreIssue[] } {
    const scanned = this.scanCanonicalClaims();
    let globalBlocked = scanned.globalBlocked;
    const issues = [...scanned.issues];
    if (existsSync(this.claimsPath)) {
      try {
        const current = JSON.parse(readFileSync(this.claimsPath, 'utf8')) as ClaimIndex;
        if (current.schemaVersion !== SCHEMA_VERSION || !verifyChecksum(current as unknown as Record<string, unknown>, 'checksum')) {
          globalBlocked = true;
          issues.push({ code: 'claim-index-invalid', message: 'claim index checksum 或 schema 無效。', file: basename(this.claimsPath) });
        } else {
          if (current.globalBlocked) {
            globalBlocked = true;
            issues.push(...current.issues);
          }
          const canonicalIds = new Set(scanned.claims.map((claim) => claim.journalId));
          for (const claim of current.claims) {
            if (!canonicalIds.has(claim.journalId)) {
              globalBlocked = true;
              issues.push({ code: 'claim-without-journal', message: 'claim index 指向不存在的 journal。', file: claim.journalId });
            }
          }
        }
      } catch {
        globalBlocked = true;
        issues.push({ code: 'claim-index-invalid', message: 'claim index 無法解析。', file: basename(this.claimsPath) });
      }
    }
    this.writeClaims(scanned.claims, globalBlocked, issues);
    return { globalBlocked, claims: scanned.claims, issues };
  }

  private scanCanonicalClaims(): { globalBlocked: boolean; claims: Claim[]; issues: CleanupStoreIssue[] } {
    const claims: Claim[] = [];
    const issues: CleanupStoreIssue[] = [];
    const migratedToQuarantine = new Set<string>();
    let globalBlocked = false;
    for (const [dir, quarantine] of [[this.activeDir, false], [this.quarantineDir, true]] as const) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).sort();
      const envelopeFiles = files.filter((file) => file.endsWith('.envelope.json'));
      const known = new Set<string>();
      for (const file of envelopeFiles) {
        const journalId = file.slice(0, -'.envelope.json'.length);
        known.add(file);
        known.add(`${journalId}.payload.json`);
        if (quarantine && migratedToQuarantine.has(journalId)) continue;
        const envelopePath = join(dir, file);
        let envelope: JournalEnvelope;
        try {
          envelope = this.readEnvelope(envelopePath);
        } catch {
          globalBlocked = true;
          issues.push({ code: 'unattributed-envelope', message: 'journal envelope 無法驗證 repository 歸屬。', file });
          continue;
        }
        const payloadPath = this.payloadPath(dir, journalId);
        let payloadValid = false;
        try {
          const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as unknown;
          payloadValid = digest(payload) === envelope.payloadChecksum;
        } catch {
          payloadValid = false;
        }
        if (!payloadValid && !quarantine) {
          mkdirSync(this.quarantineDir, { recursive: true });
          const quarantined = this.nextEnvelope(envelope, { phase: 'quarantine', zeroSideEffect: false });
          this.atomicWriteJson(this.envelopePath(this.quarantineDir, journalId), quarantined);
          if (existsSync(payloadPath)) renameSync(payloadPath, this.payloadPath(this.quarantineDir, journalId));
          unlinkSync(envelopePath);
          envelope = quarantined;
          migratedToQuarantine.add(journalId);
          issues.push({ code: 'payload-quarantined', message: 'journal payload checksum 無效，已移入 quarantine。', file });
        } else if (!payloadValid) {
          issues.push({ code: 'payload-quarantined', message: 'quarantine payload 仍無法驗證。', file });
        }
        if (envelope.phase !== 'closed') {
          claims.push({
            journalId: envelope.journalId,
            repositoryFingerprint: envelope.repositoryFingerprint,
            repositoryGeneration: envelope.repositoryGeneration,
            phase: envelope.phase === 'prepared' || envelope.phase === 'mutating' || envelope.phase === 'reconciling' ? envelope.phase : 'quarantine',
            generation: envelope.generation,
          });
        }
      }
      for (const file of files) {
        if (!known.has(file)) {
          globalBlocked = true;
          issues.push({ code: 'unknown-journal-file', message: '清理儲存區有無法歸屬的檔案。', file });
        }
      }
    }
    claims.sort((a, b) => a.journalId.localeCompare(b.journalId));
    return { globalBlocked, claims, issues };
  }

  private readEnvelope(path: string): JournalEnvelope {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as JournalEnvelope;
    if (raw.schemaVersion !== SCHEMA_VERSION || !verifyChecksum(raw as unknown as Record<string, unknown>, 'envelopeChecksum')) {
      throw new CleanupStoreError('invalid-envelope', 'journal envelope checksum 或 schema 無效。');
    }
    if (!raw.journalId || !raw.repositoryFingerprint || !raw.repositoryGeneration) {
      throw new CleanupStoreError('invalid-envelope', 'journal envelope 欄位不完整。');
    }
    return raw;
  }

  private writeClaims(claims: Claim[], globalBlocked = false, issues: CleanupStoreIssue[] = []): void {
    mkdirSync(this.root, { recursive: true });
    let generation = 1;
    if (existsSync(this.claimsPath)) {
      try {
        const current = JSON.parse(readFileSync(this.claimsPath, 'utf8')) as ClaimIndex;
        generation = Number.isInteger(current.generation) ? current.generation + 1 : 1;
      } catch {
        generation = 1;
      }
    }
    const body: ClaimIndexBody = { schemaVersion: SCHEMA_VERSION, generation, claims, globalBlocked, issues };
    this.atomicWriteJson(this.claimsPath, withChecksum(body, 'checksum'));
  }

  private readIdentityRegistry(): IdentityRegistryBody {
    if (!existsSync(this.identitiesPath)) return { schemaVersion: SCHEMA_VERSION, entries: [] };
    let parsed: IdentityRegistry;
    try {
      parsed = JSON.parse(readFileSync(this.identitiesPath, 'utf8')) as IdentityRegistry;
    } catch {
      throw new CleanupStoreError('identity-registry-invalid', 'repository identity registry 無法解析。');
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION || !verifyChecksum(parsed as unknown as Record<string, unknown>, 'checksum')) {
      throw new CleanupStoreError('identity-registry-invalid', 'repository identity registry checksum 或 schema 無效。');
    }
    return { schemaVersion: parsed.schemaVersion, entries: parsed.entries };
  }

  private writeIdentityRegistry(entries: IdentityEntry[]): void {
    const body: IdentityRegistryBody = { schemaVersion: SCHEMA_VERSION, entries };
    this.atomicWriteJson(this.identitiesPath, withChecksum(body, 'checksum'));
  }

  private fileIdentity(commonDir: string): string {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(commonDir, { bigint: true });
    } catch {
      throw new CleanupStoreError('repository-identity-unknown', '無法讀取 repository common-dir 身分。');
    }
    if (stat.ino === 0n && stat.dev === 0n) {
      throw new CleanupStoreError('repository-identity-unknown', '平台未提供穩定 filesystem identity。');
    }
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  }

  private withLock<T>(fn: () => T): T {
    mkdirSync(this.root, { recursive: true });
    let fd: number;
    try {
      fd = openSync(this.lockPath, 'wx');
    } catch {
      throw new CleanupStoreError('store-locked', '另一個 Polydesk 程序正在更新 cleanup claims。');
    }
    try {
      writeFileSync(fd, stableJson({ pid: process.pid, at: new Date().toISOString() }), 'utf8');
      fsyncSync(fd);
      return fn();
    } finally {
      closeSync(fd);
      rmSync(this.lockPath, { force: true });
    }
  }

  private atomicWriteJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const fd = openSync(temp, 'wx');
    try {
      writeFileSync(fd, `${stableJson(value)}\n`, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    // Windows 的 FlushFileBuffers 需要 writable handle；read-only handle 會 EPERM。
    const finalFd = openSync(path, 'r+');
    try {
      fsyncSync(finalFd);
    } finally {
      closeSync(finalFd);
    }
    if (process.platform !== 'win32') {
      const directoryFd = openSync(dirname(path), 'r');
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  }

  private envelopePath(dir: string, journalId: string): string {
    return join(dir, `${journalId}.envelope.json`);
  }

  private payloadPath(dir: string, journalId: string): string {
    return join(dir, `${journalId}.payload.json`);
  }
}
