import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { GatewayFailure } from './GatewayFailure';
import { RemoteService, type RemoteDeps } from './RemoteService';

const dirs: string[] = [];
const services: RemoteService[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.disable(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-remote-')); dirs.push(dir);
  let ws = { id: 'ws1', name: '授權工作區', path: dir, defaultShell: 'cmd' as const, status: 'ok' as const };
  let spawned = 0; let writes = 0; let closed = 0; let gatewaySafe = true; let now = Date.now();
  const deps: RemoteDeps = {
    statePath: join(dir, 'remote-state.json'), port: 0, now: () => now,
    gateway: { enable: async () => 'https://poly.test:8443', verify: async () => { if (!gatewaySafe) throw new Error('不安全的閘道'); }, disable: async () => undefined },
    workspaces: () => [ws], ready: () => true,
    create: () => ({ termId: `term${++spawned}` }), emit: () => undefined,
    terminalCount: () => spawned - closed,
    dimensions: () => ({ alive: true, cols: 120, rows: 35 }),
    write: () => { writes++; return true; }, close: async () => { closed++; },
  };
  const service = new RemoteService(deps); services.push(service);
  return { service, deps, changePath: () => { mkdirSync(join(dir, 'changed'), { recursive: true }); ws = { ...ws, path: join(dir, 'changed') }; }, unsafe: () => { gatewaySafe = false; }, advance: (ms: number) => { now += ms; }, counts: () => ({ spawned, writes, closed }) };
}
async function call(s: RemoteService, path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise<{ code: number; body: Record<string, unknown>; cookie?: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: s.listeningPort(), path, method: data ? 'POST' : 'GET', headers: { Host: 'poly.test:8443', 'X-Forwarded-Proto': 'https', ...(data ? { Origin: 'https://poly.test:8443', 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ code: res.statusCode!, body: JSON.parse(text), cookie: res.headers['set-cookie']?.[0].split(';')[0] }));
    }); req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function pair(s: RemoteService, lifetime: 7 | 30 | 'permanent' = 7) {
  const challenge = s.createChallenge();
  const r = await call(s, '/api/pair', { code: challenge.code, label: '我的手機' });
  expect(r.code).toBe(200);
  const pending = s.status().pending[0]; expect(pending.verification).toBe(r.body.verification);
  s.approve(pending.id, lifetime);
  const state = await call(s, '/api/session', undefined, r.cookie);
  return { cookie: r.cookie!, csrf: state.body.csrf as string, id: s.status().devices[0].id };
}
describe('remote HTTP security and launch contracts', () => {
  it('rejects unauthenticated listing, hostile Origin, Host, Funnel and code replay', async () => {
    const { service: s } = fixture(); await s.enable();
    expect((await call(s, '/api/workspaces')).code).toBe(401);
    const c = s.createChallenge();
    expect((await call(s, '/api/pair', { code: c.code, label: 'phone' }, undefined, { Origin: 'https://evil.test' })).code).toBe(403);
    expect((await call(s, '/api/session', undefined, undefined, { Host: 'evil.test' })).code).toBe(403);
    expect((await call(s, '/api/session', undefined, undefined, { 'Tailscale-Funnel-Request': '?1' })).code).toBe(403);
    await call(s, '/api/pair', { code: c.code, label: 'phone' });
    expect((await call(s, '/api/pair', { code: c.code, label: 'phone' })).code).toBe(403);
  });
  it('requires desktop approval and explicit path-bound workspace consent', async () => {
    const f = fixture(); await f.service.enable(); const auth = await pair(f.service);
    expect((await call(f.service, '/api/workspaces', undefined, auth.cookie)).body.workspaces).toEqual([]);
    f.service.allowWorkspace('ws1', true);
    expect((await call(f.service, '/api/workspaces', undefined, auth.cookie)).body.workspaces).toEqual([{ id: 'ws1', name: '授權工作區' }]);
    f.changePath();
    expect((await call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, auth.cookie, { 'X-CSRF-Token': auth.csrf })).code).toBe(403);
    expect(f.counts().spawned).toBe(0);
  });
  it('deduplicates launches and revocation before ready never writes command', async () => {
    const f = fixture(); const s = f.service; await s.enable(); const auth = await pair(s); s.allowWorkspace('ws1', true);
    const opId = crypto.randomUUID(); const headers = { 'X-CSRF-Token': auth.csrf };
    expect((await call(s, '/api/launch', { wsId: 'ws1', opId, command: 'evil' }, auth.cookie, headers)).code).toBe(400);
    expect((await call(s, '/api/launch', { wsId: 'ws1', opId }, auth.cookie)).code).toBe(403);
    expect((await call(s, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, headers)).code).toBe(200);
    await call(s, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, headers);
    expect(f.counts().spawned).toBe(1);
    s.revoke(auth.id); await s.rendererReady(opId, 'term1');
    expect(f.counts().writes).toBe(0);
    expect((await call(s, '/api/workspaces', undefined, auth.cookie)).code).toBe(401);
  });
  it('expires sessions, disables listener, and fails closed for unsafe gateway', async () => {
    const f = fixture(); await f.service.enable(); const auth = await pair(f.service);
    f.advance(7 * 86400000 + 1);
    expect((await call(f.service, '/api/workspaces', undefined, auth.cookie)).code).toBe(401);
    f.unsafe(); await f.service.checkGateway(); expect(f.service.status().enabled).toBe(false);
    expect(f.service.listeningPort()).toBe(0);
  });
  it('persists operation before creation and never resends an unfinished operation after restart', async () => {
    const f = fixture(); const s = f.service; await s.enable(); const auth = await pair(s); s.allowWorkspace('ws1', true);
    const opId = crypto.randomUUID(); await call(s, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, { 'X-CSRF-Token': auth.csrf });
    const s2 = new RemoteService(f.deps); services.push(s2); await s.disable(); await s2.enable();
    const state = await call(s2, '/api/session', undefined, auth.cookie);
    const result = await call(s2, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, { 'X-CSRF-Token': state.body.csrf as string });
    expect(result.body.state).toBe('unknown'); expect(f.counts().spawned).toBe(1);
  });
  it('stores only credential hashes, sends exactly one fixed command, and preserves sent terminals after revoke', async () => {
    const f = fixture(); await f.service.enable(); const auth = await pair(f.service); f.service.allowWorkspace('ws1', true);
    expect(readFileSync(f.deps.statePath, 'utf8')).not.toContain(auth.cookie.split('=')[1]);
    let command = ''; f.deps.write = (_id, data) => { command = data; return true; };
    const opId = crypto.randomUUID(); await call(f.service, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, { 'X-CSRF-Token': auth.csrf });
    await Promise.all([f.service.rendererReady(opId, 'term1'), f.service.rendererReady(opId, 'term1')]);
    expect(command).toBe('claude --dangerously-skip-permissions\r');
    expect((await call(f.service, `/api/result/${opId}`, undefined, auth.cookie)).body.state).toBe('sent');
    f.service.revoke(auth.id); expect(f.counts().closed).toBe(0);
  });
  it('expires challenges, rejects requests until approval, bounds payload and rate, and closes startup timeout', async () => {
    const f = fixture(); await f.service.enable(); const c = f.service.createChallenge(); f.advance(120001);
    expect((await call(f.service, '/api/pair', { code: c.code, label: 'phone' })).code).toBe(403);
    const c2 = f.service.createChallenge(); const pending = await call(f.service, '/api/pair', { code: c2.code, label: 'phone' });
    expect((await call(f.service, '/api/workspaces', undefined, pending.cookie)).code).toBe(401);
    f.service.reject(f.service.status().pending[0].id);
    expect((await call(f.service, '/api/session', undefined, pending.cookie)).body.rejected).toBe(true);
    expect((await call(f.service, '/api/pair', { code: 'x'.repeat(3000), label: 'phone' })).code).toBe(413);
    f.advance(60001); const auth = await pair(f.service); f.service.allowWorkspace('ws1', true);
    const opId = crypto.randomUUID(); await call(f.service, '/api/launch', { wsId: 'ws1', opId }, auth.cookie, { 'X-CSRF-Token': auth.csrf });
    f.advance(30001); f.service.status(); await f.service.rendererReady(opId, 'term1');
    expect(f.counts().writes).toBe(0); expect(f.counts().closed).toBe(1);
    for (let i = 0; i < 11; i++) await call(f.service, '/api/pair', { code: 'invalid', label: 'phone' });
    expect((await call(f.service, '/api/pair', { code: 'invalid', label: 'phone' })).code).toBe(429);
  });
  it('revalidates workspace path, expiration and gateway before ready and limits concurrent starts', async () => {
    const f = fixture(); await f.service.enable(); const auth = await pair(f.service); f.service.allowWorkspace('ws1', true);
    const headers = { 'X-CSRF-Token': auth.csrf };
    const results = await Promise.all([1, 2].map(() => call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, auth.cookie, headers)));
    expect(results.map(r => r.code).sort()).toEqual([200, 429]);
    f.changePath(); await f.service.rendererReady(results.find(r => r.code === 200)!.body.opId as string, 'term1');
    expect(f.counts().writes).toBe(0); expect(f.counts().closed).toBe(1);
  });
  it('counts 30-day lifetime from desktop approval and retains permanent grants until revoked', async () => {
    const thirty = fixture(); await thirty.service.enable(); const a = await pair(thirty.service, 30);
    const d = thirty.service.status().devices[0]; expect(d.expiresAt! - d.createdAt).toBe(30 * 86400000);
    thirty.advance(29 * 86400000); expect((await call(thirty.service, '/api/workspaces', undefined, a.cookie)).code).toBe(200);
    thirty.advance(86400001); expect((await call(thirty.service, '/api/workspaces', undefined, a.cookie)).code).toBe(401);
    const forever = fixture(); await forever.service.enable(); const b = await pair(forever.service, 'permanent');
    expect(forever.service.status().devices[0].expiresAt).toBeNull(); forever.advance(365 * 86400000);
    expect((await call(forever.service, '/api/workspaces', undefined, b.cookie)).code).toBe(200);
    forever.service.revoke(b.id); expect((await call(forever.service, '/api/workspaces', undefined, b.cookie)).code).toBe(401);
  });
  it('does not reuse a new path authorization for an already created terminal at the old path', async () => {
    const f = fixture(); await f.service.enable(); const a = await pair(f.service); f.service.allowWorkspace('ws1', true);
    const opId = crypto.randomUUID(); await call(f.service, '/api/launch', { wsId: 'ws1', opId }, a.cookie, { 'X-CSRF-Token': a.csrf });
    f.changePath(); f.service.allowWorkspace('ws1', true);
    await f.service.rendererReady(opId, 'term1'); expect(f.counts().writes).toBe(0); expect(f.counts().closed).toBe(1);
    expect((await call(f.service, `/api/result/${opId}`, undefined, a.cookie)).body.state).toBe('failed');
  });
  it('cancels an in-flight enable and serializes shutdown before another enable', async () => {
    const f = fixture(); let entered!: () => void; let finish!: () => void; let off = 0;
    const entering = new Promise<void>(r => { entered = r; }); const waiting = new Promise<void>(r => { finish = r; });
    f.deps.gateway.enable = async () => { entered(); await waiting; return 'https://poly.test:8443'; };
    f.deps.gateway.disable = async () => { off++; };
    const enabling = f.service.enable().catch(e => e); await entering;
    const disabling = f.service.disable(); await expect(f.service.enable()).rejects.toThrow('正在停用');
    finish(); expect((await enabling).message).toBe('啟用已取消。'); await disabling;
    expect(f.service.listeningPort()).toBe(0); expect(f.service.status().enabled).toBe(false); expect(off).toBeGreaterThan(0);
    await f.service.enable(); expect(f.service.status().enabled).toBe(true);
  });
  it('settles same-tick enable then disable without cancelling the bind callback or deadlocking', async () => {
    const f = fixture(); let enableCalls = 0;
    f.deps.gateway.enable = async () => { enableCalls++; return 'https://poly.test:8443'; };
    const enabled = f.service.enable().catch(e => e);
    const disabled = f.service.disable();
    const results = await Promise.race([Promise.all([enabled, disabled]), new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 1000))]);
    expect(results).not.toBe('timeout'); expect(enableCalls).toBe(0); expect(f.service.listeningPort()).toBe(0);
    await f.service.enable(); expect(f.service.status().enabled).toBe(true);
  });
  it('rejects a different launch immediately while gateway verification is pending instead of queuing work', async () => {
    const f = fixture(); await f.service.enable(); const a = await pair(f.service); f.service.allowWorkspace('ws1', true);
    let entered!: () => void; let release!: () => void; let checks = 0;
    const entering = new Promise<void>(r => { entered = r; }); const waiting = new Promise<void>(r => { release = r; });
    f.deps.gateway.verify = async () => { checks++; entered(); await waiting; };
    const opId = crypto.randomUUID(); const headers = { 'X-CSRF-Token': a.csrf };
    const first = call(f.service, '/api/launch', { wsId: 'ws1', opId }, a.cookie, headers); await entering;
    const second = await Promise.race([call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, a.cookie, headers), new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 500))]);
    expect(second).not.toBe('timeout'); expect((second as Awaited<ReturnType<typeof call>>).code).toBe(429);
    expect(checks).toBe(1); expect(f.counts().spawned).toBe(0);
    release(); expect((await first).code).toBe(200); expect(f.counts().spawned).toBe(1);
    expect((await call(f.service, `/api/result/${opId}`, undefined, a.cookie)).body.state).toBe('pending');
    expect((await call(f.service, '/api/launch', { wsId: 'ws1', opId }, a.cookie, headers)).code).toBe(200);
    expect(checks).toBe(1); expect(f.counts().spawned).toBe(1);
  });
  it('does not resurrect an old launch after disable and re-enable while verification was pending', async () => {
    const f = fixture(); await f.service.enable(); const a = await pair(f.service); f.service.allowWorkspace('ws1', true);
    let entered!: () => void; let release!: () => void;
    const entering = new Promise<void>(r => { entered = r; }); const waiting = new Promise<void>(r => { release = r; });
    f.deps.gateway.verify = async () => { entered(); await waiting; };
    const first = call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, a.cookie, { 'X-CSRF-Token': a.csrf }).catch(() => null); await entering;
    await f.service.disable(); f.deps.gateway.verify = async () => undefined; await f.service.enable();
    release(); await first; await new Promise(r => setTimeout(r, 20)); expect(f.counts().spawned).toBe(0);
  });
});

describe('gateway recovery', () => {
  it('rejects a slow pairing body that crosses a pause and recovery', async () => {
    const f = fixture(); await f.service.enable();
    const challenge = f.service.createChallenge();
    const body = JSON.stringify({ code: challenge.code, label: 'phone' });
    let proceed!: () => void;
    const ready = new Promise<void>(resolve => { proceed = resolve; });
    const req = request({ hostname: '127.0.0.1', port: f.service.listeningPort(), path: '/api/pair', method: 'POST', headers: {
      Host: 'poly.test:8443', 'X-Forwarded-Proto': 'https', Origin: 'https://poly.test:8443',
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Expect: '100-continue',
    } });
    const response = new Promise<number>((resolve, reject) => {
      req.on('error', reject); req.on('continue', proceed);
      req.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    });
    req.flushHeaders(); await ready;
    req.write(body.slice(0, 10));
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale timeout.'); };
    await f.service.checkGateway();
    f.deps.gateway.verify = async () => undefined; await f.service.checkGateway();
    req.end(body.slice(10));
    expect(await response).toBe(503);
    expect(f.service.status().pending).toHaveLength(0);
    expect(f.counts().spawned).toBe(0);
  });
  it('clears the retry warning when the user manually stops a paused service', async () => {
    const f = fixture(); await f.service.enable();
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale timeout.'); };
    await f.service.checkGateway(); expect(f.service.status().error).toContain('1/3');
    await f.service.disable();
    expect(f.service.status().enabled).toBe(false);
    expect(f.service.status().error).toBeNull();
  });
  it('does not let an older monitor success clear a launch failure warning', async () => {
    const f = fixture(); await f.service.enable(); f.service.allowWorkspace('ws1', true);
    const a = await pair(f.service); let release!: () => void;
    f.deps.gateway.verify = () => new Promise<void>(r => { release = r; });
    const monitor = f.service.checkGateway();
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale timeout.'); };
    expect((await call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, a.cookie, { 'X-CSRF-Token': a.csrf })).code).toBe(503);
    release(); await monitor;
    expect(f.service.status().error).toContain('1/3');
    expect((await call(f.service, '/api/session')).code).toBe(503);
    expect(f.counts().spawned).toBe(0);
  });
  it('never launches a request whose verification crossed a pause and recovery', async () => {
    const f = fixture(); await f.service.enable(); f.service.allowWorkspace('ws1', true);
    const a = await pair(f.service); let release!: () => void; let entered!: () => void;
    const entering = new Promise<void>(r => { entered = r; });
    f.deps.gateway.verify = () => new Promise<void>(r => { release = r; entered(); });
    const launch = call(f.service, '/api/launch', { wsId: 'ws1', opId: crypto.randomUUID() }, a.cookie, { 'X-CSRF-Token': a.csrf });
    await entering;
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale temporarily unavailable.'); };
    await f.service.checkGateway();
    f.deps.gateway.verify = async () => undefined; await f.service.checkGateway();
    release(); expect((await launch).code).toBe(403); expect(f.counts().spawned).toBe(0);
  });
  it('preserves the stop reason when cleanup fails and sanitizes unknown errors', async () => {
    const f = fixture(); await f.service.enable();
    f.deps.gateway.verify = async () => { throw new Error('secret stderr'); };
    f.deps.gateway.disable = async () => { throw new Error('secret cleanup'); };
    await f.service.checkGateway();
    expect(f.service.status().enabled).toBe(false);
    expect(f.service.status().error).toContain('無法安全確認');
    expect(f.service.status().error).toContain('清理失敗');
    expect(JSON.stringify(f.service.status())).not.toContain('secret');
  });
  it('pauses on transient failure, rejects requests, and recovers without replay', async () => {
    const f = fixture(); await f.service.enable();
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale temporarily unavailable.'); };
    await f.service.checkGateway();
    expect(f.service.status().enabled).toBe(true);
    expect(f.service.status().error).toContain('1/3');
    expect((await call(f.service, '/api/session')).code).toBe(503);
    f.deps.gateway.verify = async () => undefined; await f.service.checkGateway();
    expect(f.service.status().error).toBeNull(); expect(f.counts().spawned).toBe(0);
    expect(f.service.status().audit.some(a => a.result.includes('恢復'))).toBe(true);
  });
  it('disables on third transient failure and persists a readable reason', async () => {
    const f = fixture(); await f.service.enable();
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale timeout.'); };
    await f.service.checkGateway(); await f.service.checkGateway(); expect(f.service.status().enabled).toBe(true);
    await f.service.checkGateway(); expect(f.service.status().enabled).toBe(false);
    expect(f.service.status().error).toContain('timeout');
    const restored = new RemoteService(f.deps); services.push(restored);
    expect(restored.status().audit.some(a => a.result.includes('timeout'))).toBe(true);
  });
  it('does not let stale success erase a newer warning after re-enable', async () => {
    const f = fixture(); await f.service.enable(); let release!: () => void;
    f.deps.gateway.verify = () => new Promise<void>(r => { release = r; });
    const checking = f.service.checkGateway(); await f.service.disable();
    f.deps.gateway.verify = async () => undefined; await f.service.enable();
    f.deps.gateway.verify = async () => { throw new GatewayFailure('temporary', 'Tailscale temporarily unavailable.'); };
    await f.service.checkGateway(); release(); await checking;
    expect(f.service.status().error).toContain('1/3');
  });
});
