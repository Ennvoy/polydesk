import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ installed: true, commands: [] as string[][], funnel: false, conflict: false, serves: false, foreground: undefined as unknown, failOff: false }));
vi.mock('node:fs', () => ({ existsSync: () => mock.installed }));
vi.mock('node:child_process', () => ({ execFile: (_file: string, args: string[], _opts: unknown, cb: (e: Error | null, out: string) => void) => {
  mock.commands.push(args);
  if (args[0] === 'status') return cb(null, JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'desktop.team.ts.net.' } }));
  if (args.join(' ') === 'serve status --json') return cb(null, JSON.stringify({
    TCP: mock.serves || mock.conflict ? { '8443': { HTTPS: true } } : {},
    Web: mock.serves || mock.conflict ? { 'desktop.team.ts.net:8443': { Handlers: { '/': { Proxy: mock.conflict ? 'http://127.0.0.1:9999' : 'http://127.0.0.1:49387' } } } } : {},
    AllowFunnel: mock.funnel ? { 'desktop.team.ts.net:8443': true } : {},
    Foreground: mock.foreground,
  }));
  if (args.includes('--bg')) mock.serves = true;
  if (args.includes('off')) { if (mock.failOff) return cb(new Error('off failed'), ''); mock.serves = false; }
  cb(null, '');
} }));
import { TailscaleGateway } from './TailscaleGateway';
beforeEach(() => { mock.installed = true; mock.commands = []; mock.funnel = false; mock.conflict = false; mock.serves = false; mock.foreground = undefined; mock.failOff = false; });
describe('private Tailscale gateway', () => {
  it('uses fixed loopback target and removes only its own port', async () => {
    const g = new TailscaleGateway(); expect(await g.enable()).toBe('https://desktop.team.ts.net:8443');
    expect(mock.commands).toContainEqual(['serve', '--bg', '--https=8443', 'http://127.0.0.1:49387']);
    await g.disable(); expect(mock.commands).toContainEqual(['serve', '--https=8443', 'off']);
    expect(mock.commands.some(c => c.includes('funnel') || c.includes('reset'))).toBe(false);
  });
  it('refuses Funnel and existing unrelated handlers without overwriting', async () => {
    mock.funnel = true; await expect(new TailscaleGateway().enable()).rejects.toThrow('Funnel');
    expect(mock.commands.some(c => c.includes('--bg'))).toBe(false);
    mock.funnel = false; mock.conflict = true; await expect(new TailscaleGateway().enable()).rejects.toThrow('其他');
    expect(mock.commands.some(c => c.includes('--bg'))).toBe(false);
  });
  it('does not remove a matching Serve configuration it did not create', async () => {
    mock.serves = true; const g = new TailscaleGateway(); await g.enable(); await g.disable();
    expect(mock.commands.some(c => c.includes('off'))).toBe(false);
  });
  it('reports missing prerequisite and rejects configuration drift', async () => {
    mock.installed = false; await expect(new TailscaleGateway().enable()).rejects.toThrow('安裝');
    mock.installed = true; const g = new TailscaleGateway(); const url = await g.enable(); mock.funnel = true;
    await expect(g.verify(url)).rejects.toThrow('Funnel');
  });
  it('rejects Foreground Funnel at other ports and never overwrites Foreground 8443', async () => {
    const g = new TailscaleGateway(); const url = await g.enable();
    mock.foreground = { 'fixture-session': { TCP: { '443': { HTTPS: true } }, Web: { 'desktop.team.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:49387' } } } }, AllowFunnel: { 'desktop.team.ts.net:443': true } } };
    await expect(g.verify(url)).rejects.toThrow('Funnel');
    mock.serves = false; mock.commands = [];
    mock.foreground = { 'fixture-session': { TCP: { '8443': { HTTPS: true } }, Web: { 'desktop.team.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } } };
    await expect(new TailscaleGateway().enable()).rejects.toThrow('前景'); expect(mock.commands.some(c => c.includes('--bg'))).toBe(false);
  });
  it('cleans up its own endpoint even after Funnel drift and retains ownership after failed cleanup', async () => {
    const g = new TailscaleGateway(); await g.enable(); mock.funnel = true; mock.failOff = true;
    await expect(g.disable()).rejects.toThrow(); expect(mock.serves).toBe(true);
    mock.failOff = false; await g.disable(); expect(mock.serves).toBe(false);
    expect(mock.commands.filter(c => c.includes('off'))).toHaveLength(2);
  });
  it('never removes someone else’s replacement handler on cleanup', async () => {
    const g = new TailscaleGateway(); await g.enable(); mock.conflict = true;
    await expect(g.disable()).rejects.toThrow('不會覆寫'); expect(mock.commands.some(c => c.includes('off'))).toBe(false);
  });
});
