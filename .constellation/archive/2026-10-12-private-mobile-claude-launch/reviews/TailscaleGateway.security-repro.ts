import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ foreground: {} as Record<string, unknown> }));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('node:child_process', () => ({ execFile: (_file: string, args: string[], _opts: unknown, cb: (e: Error | null, out: string) => void) => {
  if (args[0] === 'status') return cb(null, JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'desktop.team.ts.net.' } }));
  cb(null, JSON.stringify({ TCP: { '8443': { HTTPS: true } }, Web: { 'desktop.team.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:49387' } } } }, AllowFunnel: {}, Foreground: mock.foreground }));
} }));
import { TailscaleGateway } from './TailscaleGateway';
beforeEach(() => { mock.foreground = {}; });
describe('independent foreground Serve config fixture', () => {
  it('fails closed when a foreground configuration enables Funnel on this node', async () => {
    const g = new TailscaleGateway(); const url = await g.enable();
    mock.foreground = { 'fixture-session': { TCP: { '443': { HTTPS: true } }, Web: { 'desktop.team.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:49387' } } } }, AllowFunnel: { 'desktop.team.ts.net:443': true } } };
    await expect(g.verify(url)).rejects.toThrow('Funnel');
  });
});
