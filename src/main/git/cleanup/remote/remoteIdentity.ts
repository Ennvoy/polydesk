import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

export function normalizeEndpoint(raw: string): string {
  const value = raw.trim();
  if (isWindowsDrivePath(value) || value.startsWith('\\\\')) {
    const path = resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
    if (scp) return `ssh://${scp[1]?.toLowerCase()}/${scp[2]}`;
    const path = resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }
}

export function endpointFingerprint(raw: string): string {
  return sha256(normalizeEndpoint(raw));
}

export function endpointLeaseId(remote: string, branch: string, fingerprint: string): string {
  return sha256(`${remote}\0${branch}\0${fingerprint}`);
}

export function endpointDisplay(raw: string): string {
  const value = raw.trim();
  if (isWindowsDrivePath(value) || value.startsWith('\\\\')) return `本機/…/${basename(value) || 'repository'}`;
  const normalized = normalizeEndpoint(value);
  try {
    const url = new URL(normalized);
    if (url.protocol === 'file:') return `本機/…/${basename(url.pathname) || 'repository'}`;
    return `${url.hostname || url.protocol.replace(':', '')}/…/${basename(url.pathname) || 'repository'}`;
  } catch {
    return `本機/…/${basename(normalized) || 'repository'}`;
  }
}

export function redactRemoteError(message: string, rawEndpoint: string): string {
  const display = endpointDisplay(rawEndpoint);
  const normalized = normalizeEndpoint(rawEndpoint);
  return message
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .split(rawEndpoint).join(display)
    .split(normalized).join(display)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b(password|passwd|token|access_token|secret)=([^\s&]+)/gi, '$1=***')
    .slice(0, 800);
}
