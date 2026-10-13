import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellKind } from '../../shared/types';
import { CLAUDE_BYPASS_COMMAND, REMOTE_PORT, type PairLifetime, type RemoteLaunchEvent, type RemoteStatus } from '../../shared/remoteLaunch';
import { MOBILE_HTML, MOBILE_SCRIPT, MOBILE_STYLE } from './mobilePage';

interface Workspace { id: string; name: string; path: string; defaultShell: ShellKind; status: string }
export interface RemoteGateway { enable(): Promise<string>; verify(url: string): Promise<void>; disable(): Promise<void> }
export interface RemoteDeps {
  statePath: string; port?: number; now?: () => number; gateway: RemoteGateway;
  workspaces(): Workspace[]; ready(): boolean; terminalCount(): number;
  create(wsId: string, shell: ShellKind): { termId: string };
  emit(event: RemoteLaunchEvent): void;
  dimensions(termId: string): { alive: boolean; cols: number; rows: number };
  write(termId: string, data: string): boolean; close(termId: string): Promise<void>;
}
interface Device { id: string; hash: string; label: string; createdAt: number; expiresAt: number | null }
interface Operation { opId: string; deviceId: string; wsId: string; at: number; state: 'pending' | 'sent' | 'failed' | 'unknown'; termId?: string; error?: string; path?: string }
interface Saved { version: 1; grants: Record<string, string>; devices: Device[]; operations: Operation[]; audit: RemoteStatus['audit'] }
interface Pending { id: string; hash: string; label: string; verification: string; expiresAt: number; rejected?: boolean }
const COOKIE = '__Host-polydesk';
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const secret = (): string => randomBytes(32).toString('base64url');
const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const DAY = 86400000;
class HttpError extends Error { constructor(public code: number, message: string) { super(message); } }
const requireShape = (body: unknown, keys: string[]): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) throw new HttpError(400, '請求格式不正確。');
  return body as Record<string, unknown>;
};

/** Independent remote state: credentials are hashes, never part of settings export/import. */
export class RemoteService {
  private saved: Saved = { version: 1, grants: {}, devices: [], operations: [], audit: [] };
  private server: Server | null = null;
  private url: string | null = null;
  private error: string | null = null;
  private challenge: { code: string; expiresAt: number } | null = null;
  private pending: Pending[] = [];
  private csrfKey = secret();
  private timer: ReturnType<typeof setInterval> | null = null;
  private rates = new Map<string, { at: number; n: number }>();
  private checking = false;
  private lifecycle = 0;
  private enabling = false;
  private startingServer: Server | null = null;
  private startingListening = false;
  private enableFinished: Promise<void> | null = null;
  private disableTask: Promise<void> | null = null;
  private launchInFlight = false;
  private now: () => number;

  constructor(private deps: RemoteDeps) {
    this.now = deps.now ?? Date.now;
    if (existsSync(deps.statePath)) {
      try {
        const s = JSON.parse(readFileSync(deps.statePath, 'utf8')) as Saved;
        if (s.version !== 1 || !s.grants || !Array.isArray(s.devices) || !Array.isArray(s.operations) || !Array.isArray(s.audit)) throw new Error('invalid');
        // Bounds and primitive validation fail closed when local state is damaged.
        if (s.devices.length > 100 || s.operations.length > 1000 || Object.keys(s.grants).length > 1000 || s.audit.length > 200) throw new Error('invalid');
        if (s.devices.some(d => typeof d.id !== 'string' || !/^[a-f0-9]{64}$/.test(d.hash) || typeof d.label !== 'string' || !Number.isFinite(d.createdAt) || (d.expiresAt !== null && !Number.isFinite(d.expiresAt)))) throw new Error('invalid');
        if (Object.values(s.grants).some(p => typeof p !== 'string')) throw new Error('invalid');
        if (s.operations.some(o => typeof o.opId !== 'string' || typeof o.deviceId !== 'string' || typeof o.wsId !== 'string' || !Number.isFinite(o.at) || !['pending', 'sent', 'failed', 'unknown'].includes(o.state))) throw new Error('invalid');
        this.saved = s;
        for (const op of s.operations) if (op.state === 'pending') { op.state = 'unknown'; op.error = '上次啟動結果不確定，請先查看電腦上的 Poly。'; }
      } catch { this.error = '遠端授權檔損毀；已清除授權，請重新配對。'; }
    }
  }
  private save(): void {
    mkdirSync(dirname(this.deps.statePath), { recursive: true });
    const tmp = `${this.deps.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.saved), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.deps.statePath);
  }
  private audit(action: string, result: string, deviceId?: string, wsId?: string): void {
    this.saved.audit.push({ at: this.now(), action, result, deviceId, wsId });
    this.saved.audit = this.saved.audit.slice(-200);
  }
  listeningPort(): number { const a = this.server?.address(); return a && typeof a !== 'string' ? a.port : 0; }
  status(): RemoteStatus {
    this.prune();
    return { enabled: !!this.server, url: this.url, error: this.error,
      workspaces: this.deps.workspaces().map(w => ({ id: w.id, name: w.name, allowed: this.allowed(w) })),
      pending: this.pending.filter(p => !p.rejected).map(({ id, label, verification, expiresAt }) => ({ id, label, verification, expiresAt })),
      devices: this.saved.devices.filter(d => this.live(d)).map(({ id, label, createdAt, expiresAt }) => ({ id, label, createdAt, expiresAt })), audit: [...this.saved.audit].reverse(), };
  }
  private live(d: Device): boolean { return d.expiresAt === null || d.expiresAt > this.now(); }
  private pathIdentity(w: Workspace): string | null {
    try { const p = realpathSync.native(w.path); return process.platform === 'win32' ? p.toLowerCase() : p; } catch { return null; }
  }
  private allowed(w: Workspace): boolean { return w.status === 'ok' && this.saved.grants[w.id] === this.pathIdentity(w); }
  allowWorkspace(id: string, allowed: boolean): void {
    const ws = this.deps.workspaces().find(w => w.id === id);
    if (!ws) throw new Error('工作區不存在。');
    if (allowed) { const path = this.pathIdentity(ws); if (!path || ws.status !== 'ok') throw new Error('工作區路徑無法使用。'); this.saved.grants[id] = path; }
    else { delete this.saved.grants[id]; this.cancel(o => o.wsId === id, '工作區授權已取消。'); }
    this.audit('workspace', allowed ? '已授權 bypass' : '已取消授權', undefined, id); this.save();
  }
  async enable(): Promise<void> {
    if (this.disableTask) throw new Error('正在停用，請完成後再啟用。');
    if (this.server) return;
    if (this.enabling) throw new Error('正在啟用，請稍候。');
    this.enabling = true;
    let finishEnable!: () => void;
    this.enableFinished = new Promise<void>(r => { finishEnable = r; });
    const gen = ++this.lifecycle;
    const server = createServer((req, res) => { void this.handle(req, res); });
    this.startingServer = server;
    this.startingListening = false;
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxConnections = 32;
    try {
      if (!this.deps.ready()) throw new Error('Poly 尚未準備完成，請稍後再試。');
      // Reserve the loopback port before publishing a proxy, so an unrelated process
      // already on the port can never be exposed under Poly's private endpoint.
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.deps.port ?? REMOTE_PORT, '127.0.0.1', () => { server.removeListener('error', reject); this.startingListening = true; resolve(); }); });
      if (gen !== this.lifecycle) throw new Error('啟用已取消。');
      const url = await this.deps.gateway.enable();
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.pathname !== '/' || u.username || u.password) throw new Error('遠端閘道必須使用私有 HTTPS。');
      await this.deps.gateway.verify(url);
      if (gen !== this.lifecycle) throw new Error('啟用已取消。');
      this.url = u.origin;
      this.server = server; this.error = null;
      this.startingServer = null;
      this.startingListening = false;
      this.timer = setInterval(() => { this.prune(); void this.checkGateway(); }, 10000); this.timer.unref();
      this.audit('remote', '已啟用'); this.save();
    } catch (e) {
      if (this.timer) clearInterval(this.timer); this.timer = null;
      this.startingServer = null;
      this.startingListening = false;
      this.url = null; this.server = null; server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
      await this.deps.gateway.disable().catch(() => undefined);
      this.error = e instanceof Error ? e.message : '無法啟用遠端功能。'; throw new Error(this.error);
    }
    finally { this.enabling = false; this.enableFinished = null; finishEnable(); }
  }
  disable(): Promise<void> {
    if (this.disableTask) return this.disableTask;
    ++this.lifecycle;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    // close() before the listen callback cancels that callback in Node. Let the
    // enable path observe cancellation and close its own socket after bind settles.
    const server = this.server ?? (this.startingListening ? this.startingServer : null);
    this.server = null; this.startingServer = null; this.startingListening = false; this.url = null; this.challenge = null; this.pending = [];
    this.cancel(() => true, '遠端功能已停用。');
    const enableFinished = this.enableFinished;
    const run = async (): Promise<void> => {
      try {
        if (server) await new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); });
        // An in-flight enable may finish creating Serve after cancellation. It must
        // clean up first; new enables stay blocked until this shutdown completes.
        if (enableFinished) await enableFinished;
        await this.deps.gateway.disable().catch(() => { this.error = '手機入口已停止，但 Tailscale 入口清理失敗；請檢查 Tailscale Serve 設定。'; });
        this.audit('remote', '已停用'); this.save();
      } finally { this.disableTask = null; }
    };
    this.disableTask = run(); return this.disableTask;
  }
  async checkGateway(): Promise<void> {
    if (!this.url || this.checking) return;
    this.checking = true;
    const gen = this.lifecycle;
    try { await this.deps.gateway.verify(this.url); }
    catch { if (gen === this.lifecycle) { this.error = 'Tailscale 私有連線狀態改變；遠端功能已停用，請檢查後重新啟用。'; await this.disable(); } }
    finally { this.checking = false; }
  }
  createChallenge(): { code: string; url: string; expiresAt: number } {
    if (!this.url || !this.server) throw new Error('請先啟用遠端功能。');
    this.challenge = { code: randomBytes(16).toString('hex'), expiresAt: this.now() + 120000 };
    return { ...this.challenge, url: `${this.url}/#pair=${this.challenge.code}` };
  }
  approve(id: string, lifetime: PairLifetime): void {
    this.prune(); const p = this.pending.find(p => p.id === id && !p.rejected);
    if (!p || !this.server) throw new Error('配對申請已過期，請重新掃碼。');
    if (![7, 30, 'permanent'].includes(lifetime)) throw new Error('配對期限不正確。');
    if (this.saved.devices.filter(d => this.live(d)).length >= 20) throw new Error('最多配對 20 個瀏覽器，請先撤銷舊裝置。');
    this.saved.devices.push({ id: p.id, hash: p.hash, label: p.label, createdAt: this.now(), expiresAt: lifetime === 'permanent' ? null : this.now() + lifetime * DAY });
    this.pending = this.pending.filter(x => x.id !== id); this.audit('pair', '已批准', id); this.save();
  }
  reject(id: string): void { const p = this.pending.find(p => p.id === id); if (p) { p.rejected = true; this.audit('pair', '已拒絕', id); this.save(); } }
  revoke(id: string): void { this.saved.devices = this.saved.devices.filter(d => d.id !== id); this.cancel(o => o.deviceId === id, '手機授權已撤銷。'); this.audit('revoke', '已撤銷', id); this.save(); }
  private cancel(predicate: (op: Operation) => boolean, error: string): void {
    for (const op of this.saved.operations) if (op.state === 'pending' && predicate(op)) {
      op.state = 'failed'; op.error = error; if (op.termId) void this.deps.close(op.termId);
      this.audit('launch', error, op.deviceId, op.wsId);
    }
  }
  private prune(): void {
    const now = this.now(); this.pending = this.pending.filter(p => p.expiresAt > now);
    this.saved.devices = this.saved.devices.filter(d => this.live(d));
    this.cancel(o => o.at + 30000 < now || !this.saved.devices.some(d => d.id === o.deviceId && this.live(d)), '啟動逾時或授權過期；請查看電腦後再操作。');
    this.saved.operations = this.saved.operations.filter(o => o.at > now - 7 * DAY).slice(-1000);
    for (const [key, v] of this.rates) if (v.at + 60000 < now) this.rates.delete(key);
  }
  private rate(key: string, limit: number): void {
    const now = this.now(); let r = this.rates.get(key);
    if (!r || r.at + 60000 < now) { r = { at: now, n: 0 }; this.rates.set(key, r); }
    if (++r.n > limit) throw new HttpError(429, '操作太頻繁，請等一分鐘再試。');
  }
  private token(req: IncomingMessage): string { return (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? ''; }
  private device(req: IncomingMessage): Device {
    const t = this.token(req); if (!/^[A-Za-z0-9_-]{43}$/.test(t)) throw new HttpError(401, '尚未配對，或授權已過期／撤銷。');
    const d = this.saved.devices.find(d => same(d.hash, hash(t)) && this.live(d));
    if (!d) throw new HttpError(401, '尚未配對，或授權已過期／撤銷。'); return d;
  }
  private csrf(d: Device): string { return createHmac('sha256', this.csrfKey).update(d.hash).digest('base64url'); }
  private cookie(res: ServerResponse, token: string, ttl: number): void { res.setHeader('Set-Cookie', `${COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(ttl / 1000))}`); }
  private async json(req: IncomingMessage): Promise<unknown> {
    if (req.headers['content-type'] !== 'application/json') throw new HttpError(415, '僅接受 JSON。');
    if (Number(req.headers['content-length'] ?? 0) > 2048) throw new HttpError(413, '請求過大。');
    let text = ''; for await (const chunk of req) { text += String(chunk); if (Buffer.byteLength(text) > 2048) throw new HttpError(413, '請求過大。'); }
    try { return JSON.parse(text); } catch { throw new HttpError(400, '請求格式不正確。'); }
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (code: number, value: unknown): void => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      this.prune();
      if (!this.url || req.headers.host !== new URL(this.url).host || req.headers['x-forwarded-proto'] !== 'https' || req.headers['tailscale-funnel-request']) throw new HttpError(403, '此連線不是核准的私有 HTTPS 入口。');
      if (req.headers.origin && req.headers.origin !== this.url) throw new HttpError(403, '來源不正確。');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '來源不正確。');
      this.rate('global', 600);
      const path = req.url;
      if (req.method === 'GET' && ['/', '/mobile.js', '/mobile.css'].includes(path ?? '')) {
        const value = path === '/' ? MOBILE_HTML : path === '/mobile.js' ? MOBILE_SCRIPT : MOBILE_STYLE;
        res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : path === '/mobile.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(value); return;
      }
      if (req.method === 'POST') { if (req.headers.origin !== this.url) throw new HttpError(403, '來源不正確。'); }
      if (req.method === 'POST' && path === '/api/pair') {
        this.rate('pair', 10);
        const b = requireShape(await this.json(req), ['code', 'label']); const c = this.challenge;
        if (typeof b.code !== 'string' || !c || c.expiresAt <= this.now() || !same(b.code, c.code)) throw new HttpError(403, '配對碼無效或已過期，請在電腦重新產生。');
        if (typeof b.label !== 'string' || b.label.trim().length < 1 || b.label.length > 40 || /[\x00-\x1f\x7f]/.test(b.label)) throw new HttpError(400, '請輸入 1 至 40 字的手機名稱。');
        if (this.pending.length >= 10) throw new HttpError(429, '配對申請太多，請在電腦處理。');
        this.challenge = null; const t = secret();
        const p: Pending = { id: randomUUID(), hash: hash(t), label: b.label.trim(), verification: randomBytes(3).toString('hex').toUpperCase(), expiresAt: this.now() + 120000 };
        this.pending.push(p); this.cookie(res, t, 120000); reply(200, { pending: true, verification: p.verification }); return;
      }
      if (req.method === 'GET' && path === '/api/session') {
        const t = this.token(req); const h = hash(t); const d = this.saved.devices.find(d => same(d.hash, h) && this.live(d));
        if (d) { this.cookie(res, t, d.expiresAt === null ? 400 * DAY : d.expiresAt - this.now()); reply(200, { paired: true, csrf: this.csrf(d), label: d.label, expiresAt: d.expiresAt }); return; }
        const p = this.pending.find(p => same(p.hash, h)); reply(200, p ? { paired: false, pending: !p.rejected, rejected: !!p.rejected, verification: p.verification } : { paired: false }); return;
      }
      const d = this.device(req); this.rate(`device:${d.id}`, 180);
      if (req.method === 'GET' && path === '/api/workspaces') { reply(200, { workspaces: this.deps.workspaces().filter(w => this.allowed(w)).map(({ id, name }) => ({ id, name })) }); return; }
      if (req.method === 'GET' && path?.startsWith('/api/result/')) {
        const opId = path.slice('/api/result/'.length); const op = this.saved.operations.find(o => o.opId === opId && o.deviceId === d.id);
        reply(200, op ? this.publicOp(op) : { state: 'unknown', error: '查不到結果；請先查看電腦上的 Poly，再手動建立新操作。' }); return;
      }
      if (req.method === 'POST' && path === '/api/launch') {
        const csrf = req.headers['x-csrf-token']; if (typeof csrf !== 'string' || !same(csrf, this.csrf(d))) throw new HttpError(403, '安全驗證失敗，請重新整理。');
        const body = requireShape(await this.json(req), ['wsId', 'opId']);
        if (typeof body.wsId !== 'string' || body.wsId.length > 100 || typeof body.opId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.opId)) throw new HttpError(400, '啟動資料不正確。');
        const old = this.saved.operations.find(o => o.opId === body.opId);
        if (old) {
          if (old.deviceId !== d.id || old.wsId !== body.wsId) throw new HttpError(409, '操作識別碼已使用。');
          reply(200, this.publicOp(old)); return;
        }
        // Reject extra work before slow CLI verification. Never hold a backlog of
        // requests that could unexpectedly launch long after the phone disconnects.
        if (this.launchInFlight) throw new HttpError(429, '上一個啟動仍在驗證，請稍候並查詢原操作結果。');
        this.launchInFlight = true;
        try { reply(200, this.publicOp(await this.launch(d.id, body.wsId as string, body.opId as string))); }
        finally { this.launchInFlight = false; }
        return;
      }
      throw new HttpError(404, '找不到此操作。');
    } catch (e) { reply(e instanceof HttpError ? e.code : 503, { error: e instanceof HttpError ? e.message : '操作無法完成，請查看電腦上的 Poly。' }); }
  }
  private authorize(deviceId: string, wsId: string): Workspace {
    if (!this.server || !this.deps.ready() || !this.saved.devices.some(d => d.id === deviceId && this.live(d))) throw new HttpError(403, '遠端授權失效或 Poly 尚未就緒。');
    const w = this.deps.workspaces().find(w => w.id === wsId);
    if (!w || !this.allowed(w)) throw new HttpError(403, '此工作區未授權、路徑已變更或已無法使用。'); return w;
  }
  private publicOp(op: Operation): object { return { opId: op.opId, state: op.state, error: op.error, message: op.state === 'sent' ? '已新增 Claude bypass 分頁並送出啟動命令；CLI 登入與後續狀態請查看電腦。' : op.state === 'pending' ? '已建立分頁，等待終端機尺寸就緒。' : undefined }; }
  private async launch(deviceId: string, wsId: string, opId: string): Promise<Operation> {
    const old = this.saved.operations.find(o => o.opId === opId);
    if (old) { if (old.deviceId !== deviceId || old.wsId !== wsId) throw new HttpError(409, '操作識別碼已使用。'); return old; }
    const generation = this.lifecycle;
    await this.deps.gateway.verify(this.url!);
    if (generation !== this.lifecycle) throw new HttpError(403, '遠端功能已停用；原啟動請求已取消。');
    const w = this.authorize(deviceId, wsId);
    if (this.saved.operations.some(o => o.state === 'pending') || this.saved.operations.some(o => o.at > this.now() - 2000)) throw new HttpError(429, '上一個啟動仍在處理，請稍候。');
    if (this.deps.terminalCount() >= 30) throw new HttpError(429, '終端機已達 30 個上限，請在電腦關閉不使用的分頁。');
    if (this.saved.operations.length >= 1000) throw new HttpError(429, '啟動紀錄已達上限，請稍後再試。');
    const path = this.pathIdentity(w);
    if (!path) throw new HttpError(403, '工作區路徑無法使用。');
    const op: Operation = { opId, deviceId, wsId, path, at: this.now(), state: 'pending' };
    this.saved.operations.push(op); this.save(); // Write ahead of spawn: never repeat after crash.
    try {
      const result = this.deps.create(wsId, w.defaultShell); op.termId = result.termId; this.save();
      this.deps.emit({ opId, termId: result.termId, wsId, shell: w.defaultShell });
      this.audit('launch', '已建立分頁，等待尺寸', deviceId, wsId); this.save();
    } catch { op.state = 'failed'; op.error = '無法建立終端機，請查看電腦上的 shell 設定。'; if (op.termId) await this.deps.close(op.termId); this.save(); }
    return op;
  }
  async rendererReady(opId: string, termId: string): Promise<void> {
    const op = this.saved.operations.find(o => o.opId === opId && o.termId === termId);
    if (!op || op.state !== 'pending') return;
    try {
      await this.deps.gateway.verify(this.url!);
      if (op.state !== 'pending') return;
      const w = this.authorize(op.deviceId, op.wsId);
      if (!op.path || this.pathIdentity(w) !== op.path) throw new Error('工作區路徑與建立終端機時不同。');
      const dims = this.deps.dimensions(termId);
      if (!dims.alive || dims.cols < 2 || dims.rows < 2) throw new Error('尺寸尚未就緒');
      // Persist uncertain outcome before writing: a crash must never resend a command.
      op.state = 'unknown'; this.save();
      if (!this.deps.write(termId, `${CLAUDE_BYPASS_COMMAND}\r`)) throw new Error('PTY已結束');
      op.state = 'sent'; this.audit('launch', '已送出命令', op.deviceId, op.wsId); this.save();
    } catch { if (op.state === 'pending' || op.state === 'unknown') { op.state = 'failed'; op.error = '啟動未完成：授權、私有連線或終端機已失效。'; await this.deps.close(termId); this.audit('launch', '啟動失敗', op.deviceId, op.wsId); this.save(); } }
  }
}
