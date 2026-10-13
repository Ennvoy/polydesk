import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REMOTE_PORT, REMOTE_HTTPS_PORT } from '../../shared/remoteLaunch';
import type { RemoteGateway } from './RemoteService';

/** Fixed executable and argv: neither renderer nor mobile can choose a command. */
export class TailscaleGateway implements RemoteGateway {
  private ownedUrl: string | null = null;
  private command(args: string[]): Promise<string> {
    const file = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
    if (!existsSync(file)) return Promise.reject(new Error('尚未安裝 Tailscale。請在電腦與手機安裝並登入同一個私人網路。'));
    return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }, (e, stdout) => e ? reject(new Error('Tailscale 指令未完成。請確認已登入、私人 HTTPS 已啟用，再重新啟用手機功能。')) : resolve(stdout)));
  }
  private async identity(): Promise<string> {
    const status = JSON.parse(await this.command(['status', '--json'])) as { BackendState?: string; Self?: { DNSName?: string } };
    if (status.BackendState !== 'Running' || !status.Self?.DNSName) throw new Error('Tailscale 尚未連線或未登入，請先在電腦完成登入。');
    const dns = status.Self.DNSName.replace(/\.$/, '');
    if (!/^[a-z0-9][a-z0-9.-]+\.ts\.net$/i.test(dns)) throw new Error('無法確認 Tailscale 私人 HTTPS 位址。');
    return `https://${dns}:${REMOTE_HTTPS_PORT}`;
  }
  private async config(): Promise<Record<string, unknown>> { return JSON.parse(await this.command(['serve', 'status', '--json'])) as Record<string, unknown>; }
  private configurations(config: Record<string, unknown>): Record<string, unknown>[] {
    const all: Record<string, unknown>[] = [];
    const walk = (value: unknown, depth: number): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4 || all.length >= 64) throw new Error('無法安全確認 Tailscale 前景服務設定。');
      const cfg = value as Record<string, unknown>; all.push(cfg);
      if (cfg.Foreground !== undefined && cfg.Foreground !== null) {
        if (typeof cfg.Foreground !== 'object' || Array.isArray(cfg.Foreground)) throw new Error('無法安全確認 Tailscale 前景服務設定。');
        for (const child of Object.values(cfg.Foreground)) walk(child, depth + 1);
      }
    };
    walk(config, 0); return all;
  }
  private occupied(config: Record<string, unknown>): boolean {
    const tcp = config.TCP as Record<string, unknown> | undefined;
    const web = config.Web as Record<string, unknown> | undefined;
    return !!tcp?.[String(REMOTE_HTTPS_PORT)] || Object.keys(web ?? {}).some(k => k.endsWith(`:${REMOTE_HTTPS_PORT}`));
  }
  private matching(config: Record<string, unknown>, url: string): boolean {
    const tcp = config.TCP as Record<string, { HTTPS?: boolean }> | undefined;
    const web = config.Web as Record<string, { Handlers?: Record<string, { Proxy?: string }> }> | undefined;
    const handlers = web?.[new URL(url).host]?.Handlers;
    const target = `http://127.0.0.1:${REMOTE_PORT}`;
    const port = tcp?.[String(REMOTE_HTTPS_PORT)];
    return port?.HTTPS === true && !!handlers && Object.keys(handlers).length === 1 && handlers['/']?.Proxy === target && !Object.keys(web ?? {}).some(k => k !== new URL(url).host && k.endsWith(`:${REMOTE_HTTPS_PORT}`));
  }
  private safe(config: Record<string, unknown>, url: string, required: boolean): void {
    const configs = this.configurations(config);
    for (const [i, cfg] of configs.entries()) {
      const funnel = cfg.AllowFunnel;
      if (funnel !== undefined && funnel !== null && (typeof funnel !== 'object' || Array.isArray(funnel) || Object.values(funnel).some(v => typeof v !== 'boolean' || v))) throw new Error('偵測到 Tailscale Funnel 公開入口，請先關閉 Funnel；Poly 僅允許私人 Serve。');
      if (i > 0 && this.occupied(cfg)) throw new Error('8443 已被 Tailscale 前景服務使用，請先處理衝突。');
    }
    if (this.occupied(config) && !this.matching(config, url)) throw new Error('8443 已被其他 Tailscale 服務使用，請先處理衝突。');
    if (required && !this.matching(config, url)) throw new Error('Tailscale 私人 Serve 設定已變更。');
  }
  async enable(): Promise<string> {
    const url = await this.identity(); const config = await this.config(); this.safe(config, url, false);
    if (!(config.TCP as Record<string, unknown> | undefined)?.[String(REMOTE_HTTPS_PORT)]) {
      await this.command(['serve', '--bg', `--https=${REMOTE_HTTPS_PORT}`, `http://127.0.0.1:${REMOTE_PORT}`]);
      this.ownedUrl = url;
    }
    await this.verify(url); return url;
  }
  async verify(url: string): Promise<void> { if (await this.identity() !== url) throw new Error('Tailscale 位址已改變。'); this.safe(await this.config(), url, true); }
  async disable(): Promise<void> {
    if (!this.ownedUrl) return;
    // Public configuration drift must not prevent removal of our own still-matching
    // endpoint. Ownership is retained until off succeeds, so failures can be retried.
    const config = await this.config();
    if (!this.occupied(config)) { this.ownedUrl = null; return; }
    if (!this.matching(config, this.ownedUrl)) throw new Error('Tailscale 8443 已改為其他服務，請手動檢查；Poly 不會覆寫。');
    const all = this.configurations(config);
    if (all.slice(1).some(cfg => this.occupied(cfg))) throw new Error('Tailscale 8443 有前景服務衝突，請手動檢查。');
    await this.command(['serve', `--https=${REMOTE_HTTPS_PORT}`, 'off']);
    this.ownedUrl = null;
  }
}
