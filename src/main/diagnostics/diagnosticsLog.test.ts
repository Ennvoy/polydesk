import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import { appendLog, errorText, formatLine, sanitizeText, shouldRotate } from './diagnosticsLog';

describe('diagnosticsLog', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pd-diag-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('formatLine 輸出單行 JSON 且 at／kind 不被 data 覆寫', () => {
    const line = formatLine('x', { at: 'bad', kind: 'bad', n: 1 }, new Date('2026-01-02T03:04:05.000Z'));
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ at: '2026-01-02T03:04:05.000Z', kind: 'x', n: 1 });
  });

  it('formatLine 遇循環參照不丟例外', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(JSON.parse(formatLine('x', a)).error).toBe('unserializable-data');
  });

  it('shouldRotate 只在非空且超限時為真', () => {
    expect(shouldRotate(0, 100, 50)).toBe(false);
    expect(shouldRotate(10, 10, 50)).toBe(false);
    expect(shouldRotate(40, 20, 50)).toBe(true);
  });

  it('appendLog 逐行附加並自動建立目錄', () => {
    const logs = join(dir, 'nested', 'logs');
    appendLog(logs, 'a', { v: 1 });
    appendLog(logs, 'b');
    const lines = readFileSync(join(logs, 'main.log'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.kind)).toEqual(['a', 'b']);
    expect(lines[0].v).toBe(1);
  });

  it('超過上限時輪替成 main.1.log 且只留一代', () => {
    appendLog(dir, 'first', undefined, 100);
    appendLog(dir, 'second', { pad: 'x'.repeat(120) }, 100);
    appendLog(dir, 'third', { pad: 'y'.repeat(120) }, 100);
    expect(JSON.parse(readFileSync(join(dir, 'main.1.log'), 'utf-8').trim()).kind).toBe('second');
    expect(JSON.parse(readFileSync(join(dir, 'main.log'), 'utf-8').trim()).kind).toBe('third');
    expect(existsSync(join(dir, 'main.2.log'))).toBe(false);
  });

  it('寫入失敗不丟例外', () => {
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'x');
    expect(() => appendLog(join(blocker, 'sub'), 'a')).not.toThrow();
  });
  it('sanitizeText 遮罩 URL 內嵌帳密並截到 4096 字元', () => {
    expect(sanitizeText('fail https://user:pa55@host/x and git@github.com:a/b')).toBe('fail https://***@host/x and git@github.com:a/b');
    expect(sanitizeText('x'.repeat(5000))).toHaveLength(4096);
    expect(errorText(new Error('clone https://tok@h/r'))).toContain('//***@h/r');
    expect(errorText('plain')).toBe('plain');
  });

  it('輪替 rename 失敗時仍照常 append', () => {
    appendLog(dir, 'first', undefined, 100);
    // main.1.log 以目錄佔位，rename 於 Windows／POSIX 皆會失敗
    mkdirSync(join(dir, 'main.1.log', 'keep'), { recursive: true });
    expect(() => appendLog(dir, 'second', { pad: 'x'.repeat(120) }, 100)).not.toThrow();
    const kinds = readFileSync(join(dir, 'main.log'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l).kind);
    expect(kinds).toEqual(['first', 'second']);
  });
});
