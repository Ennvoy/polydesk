import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { RemoteService, type RemoteDeps } from './RemoteService';

const roots: string[] = [];
const running: RemoteService[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.disable();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(process.cwd(), '.security-fixture-')); roots.push(root);
  const a = join(root, 'a'); const b = join(root, 'b'); mkdirSync(a); mkdirSync(b);
  let ws = [{ id: 'w', name: 'fixture', path: a, defaultShell: 'cmd' as const, status: 'ok' }];
  let now = Date.now(); let created = 0; let writes = 0; let closes = 0;
  let hold: Promise<void> | undefined; let release = () => {};
  const deps: RemoteDeps = {
    statePath: join(root, 'state.json'), port: 0, now: () => now,
    gateway: { enable: async () => 'https://poly.test:8443', verify: async () => { if (hold) await hold; }, disable: async () => {} },
    workspaces: () => ws, ready: () => true, terminalCount: () => created - closes,
    create: () => ({ termId: `t${++created}` }), emit: () => {}, dimensions: () => ({ alive: true, cols: 120, rows: 30 }),
    write: () => { writes++; return true; }, close: async () => { closes++; },
  };
  const s = new RemoteService(deps); running.push(s);
  return { s, deps, advance: (ms: number) => { now += ms; }, retarget: () => { ws = [{ ...ws[0], path: b }]; }, remove: () => { ws = []; },
    pause: () => { hold = new Promise<void>(r => { release = r; }); }, resume: () => { hold = undefined; release(); },
    counts: () => ({ created, writes, closes }) };
}
async function api(s: RemoteService, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise<{ code: number; data: Record<string, unknown>; cookie: string; setCookie: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: s.listeningPort(), path, method: raw ? 'POST' : 'GET', headers: {
      Host: 'poly.test:8443', 'X-Forwarded-Proto': 'https', ...(raw ? { Origin: 'https://poly.test:8443', 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers,
    } }, res => { let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ code: res.statusCode!, data: JSON.parse(text), cookie: res.headers['set-cookie']?.[0].split(';')[0] ?? '', setCookie: res.headers['set-cookie']?.[0] ?? '' })); });
    req.on('error', reject); req.end(raw);
  });
}
async function pair(s: RemoteService) {
  const c = s.createChallenge(); const r = await api(s, '/api/pair', { code: c.code, label: 'fixture' });
  expect(r.code).toBe(200); const id = s.status().pending[0].id; s.approve(id, 7);
  const state = await api(s, '/api/session', undefined, r.cookie);
  return { cookie: r.cookie, id, headers: { 'X-CSRF-Token': state.data.csrf as string } };
}
describe('independent security boundary fixtures', () => {
  it('rejects a syntactically valid unauthorized cookie and hostile launch origin without side effects', async () => {
    const f = fixture(); await f.s.enable();
    expect((await api(f.s, '/api/workspaces', undefined, `__Host-polydesk=${'A'.repeat(43)}`)).code).toBe(401);
    const a = await pair(f.s); f.s.allowWorkspace('w', true);
    expect((await api(f.s, '/api/launch', { wsId: 'w', opId: crypto.randomUUID() }, a.cookie, { ...a.headers, Origin: 'https://hostile.invalid' })).code).toBe(403);
    expect(f.counts().created).toBe(0);
  });
  it('consumes a challenge atomically and cannot approve an expired pending browser', async () => {
    const f = fixture(); await f.s.enable(); const c = f.s.createChallenge();
    const results = await Promise.all([api(f.s, '/api/pair', { code: c.code, label: 'a' }), api(f.s, '/api/pair', { code: c.code, label: 'b' })]);
    expect(results.map(r => r.code).sort()).toEqual([200, 403]);
    const winner = results.find(r => r.code === 200)!;
    expect(winner.setCookie).toContain('Secure; HttpOnly; SameSite=Strict; Path=/;');
    const id = f.s.status().pending[0].id; f.advance(120001);
    expect(() => f.s.approve(id, 7)).toThrow();
    expect((await api(f.s, '/api/workspaces', undefined, winner.cookie)).code).toBe(401);
  });
  it('rechecks revocation after the asynchronous pre-send gateway check', async () => {
    const f = fixture(); await f.s.enable(); const a = await pair(f.s); f.s.allowWorkspace('w', true);
    const opId = crypto.randomUUID(); await api(f.s, '/api/launch', { wsId: 'w', opId }, a.cookie, a.headers);
    f.pause(); const ready = f.s.rendererReady(opId, 't1'); f.s.revoke(a.id); f.resume(); await ready;
    expect(f.counts()).toEqual({ created: 1, writes: 0, closes: 1 });
  });
  it('blocks a removed workspace and retargeted workspace before send', async () => {
    for (const action of ['remove', 'retarget'] as const) {
      const f = fixture(); await f.s.enable(); const a = await pair(f.s); f.s.allowWorkspace('w', true);
      const opId = crypto.randomUUID(); await api(f.s, '/api/launch', { wsId: 'w', opId }, a.cookie, a.headers);
      f[action](); await f.s.rendererReady(opId, 't1'); expect(f.counts().writes).toBe(0);
    }
  });
  it('same operation concurrently and after restart never creates a second terminal', async () => {
    const f = fixture(); await f.s.enable(); const a = await pair(f.s); f.s.allowWorkspace('w', true);
    const body = { wsId: 'w', opId: crypto.randomUUID() };
    const first = await Promise.all([api(f.s, '/api/launch', body, a.cookie, a.headers), api(f.s, '/api/launch', body, a.cookie, a.headers)]);
    expect(first.map(r => r.code)).toEqual([200, 200]); expect(f.counts().created).toBe(1);
    const restart = new RemoteService(f.deps); running.push(restart); await f.s.disable(); await restart.enable();
    const session = await api(restart, '/api/session', undefined, a.cookie);
    const repeat = await api(restart, '/api/launch', body, a.cookie, { 'X-CSRF-Token': session.data.csrf as string });
    expect(repeat.data.state).toBe('unknown'); expect(f.counts().created).toBe(1);
  });
  it('does not send to the old terminal after a workspace is retargeted and freshly authorized', async () => {
    const f = fixture(); await f.s.enable(); const a = await pair(f.s); f.s.allowWorkspace('w', true);
    const opId = crypto.randomUUID(); await api(f.s, '/api/launch', { wsId: 'w', opId }, a.cookie, a.headers);
    f.retarget(); f.s.allowWorkspace('w', true); await f.s.rendererReady(opId, 't1');
    expect(f.counts().writes).toBe(0);
  });
});
