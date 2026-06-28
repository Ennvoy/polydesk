// F-5 serverProbe 單元測試。
// - 一般探測：found / not-found → available 正確（注入 pathDirs/exists，受控但真實演算法）。
// - 紅軍 F-5-A2（cwd 執行檔劫持）：工作區根放同名 binary（gopls.cmd），probe 不得回傳落在工作區
//   目錄樹內的路徑；excludeDirs 內的目錄一律跳過。

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeServer, resolveOnPath } from './serverProbe';

describe('serverProbe 一般探測（REQ-EDIT-004）', () => {
  const exists = (set: Set<string>) => (p: string): boolean => set.has(p.toLowerCase());

  it('PATH 內存在 → available:true 且回絕對路徑', () => {
    const toolsDir = 'C:\\tools';
    const present = new Set([join(toolsDir, 'gopls.exe').toLowerCase()]);
    const info = probeServer('go', {
      platform: 'win32',
      pathDirs: [toolsDir],
      pathExts: ['', '.exe', '.cmd'],
      exists: exists(present),
    });
    expect(info.available).toBe(true);
    expect(info.command).toBe(join(toolsDir, 'gopls.exe'));
    expect(info.langId).toBe('go');
  });

  it('PATH 內不存在 → available:false 但附 installable/installHint（不擋路）', () => {
    const info = probeServer('rust', {
      platform: 'win32',
      pathDirs: ['C:\\tools'],
      pathExts: ['', '.EXE'],
      exists: () => false,
    });
    expect(info.available).toBe(false);
    expect(info.command).toBeUndefined();
    expect(info.installable).toBe(true);
    expect(info.installHint).toContain('rust-analyzer');
  });

  it('未支援 langId → available:false / installable:false', () => {
    const info = probeServer('cobol', { pathDirs: [], exists: () => false });
    expect(info.available).toBe(false);
    expect(info.installable).toBe(false);
  });
});

describe('serverProbe 安全：cwd / 工作區執行檔劫持（F-5-A2 / REQ-SEC-003）', () => {
  it('工作區根放 gopls.cmd，且工作區在 PATH/cwd 中 → 仍不解析到工作區內路徑', () => {
    const ws = mkdtempSync(join(tmpdir(), 'polydesk-lsp-probe-'));
    try {
      // 攻擊者在 repo 根放劫持檔
      writeFileSync(join(ws, 'gopls.cmd'), '@echo off\r\n');
      writeFileSync(join(ws, 'gopls.exe'), 'MZ');

      // 模擬「工作區目錄被混進掃描範圍」（cwd 或被污染的 PATH）
      const info = probeServer('go', {
        platform: 'win32',
        pathDirs: [ws],
        pathExts: ['', '.exe', '.cmd'],
        excludeDirs: [ws],
        // 用真實 existsSync 走預設即可，但這裡用真實檔案存在語意
      });
      // 工作區被排除 → 找不到（available:false），絕不回工作區內的劫持檔
      expect(info.available).toBe(false);
      expect(info.command).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('正當 PATH 目錄有 binary、工作區也有同名劫持檔 → 解析到正當絕對路徑（不在工作區樹內）', () => {
    const ws = mkdtempSync(join(tmpdir(), 'polydesk-lsp-ws-'));
    const tools = mkdtempSync(join(tmpdir(), 'polydesk-lsp-tools-'));
    try {
      writeFileSync(join(ws, 'gopls.exe'), 'MZ'); // 劫持檔
      writeFileSync(join(tools, 'gopls.exe'), 'MZ'); // 正當檔

      const info = probeServer('go', {
        platform: 'win32',
        // 工作區排在前面（模擬 cwd 優先），但會被 excludeDirs 跳過
        pathDirs: [ws, tools],
        pathExts: ['', '.exe', '.cmd'],
        excludeDirs: [ws],
      });
      expect(info.available).toBe(true);
      expect(info.command).toBe(join(tools, 'gopls.exe'));
      // 解析結果不得落在工作區目錄樹內
      expect(info.command?.startsWith(ws)).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(tools, { recursive: true, force: true });
    }
  });

  it('resolveOnPath 不掃描 cwd / "."（PATH 未含則找不到，即使 cwd 有同名檔）', () => {
    // pathDirs 不含 cwd；exists 對 "<cwd>/gopls.exe" 回 true 也不該被命中
    const calls: string[] = [];
    const hit = resolveOnPath('gopls', {
      platform: 'win32',
      pathDirs: ['C:\\real-tools'],
      pathExts: ['', '.EXE'],
      exists: (p) => {
        calls.push(p);
        return false;
      },
    });
    expect(hit).toBeNull();
    // 掃描的候選一律落在指定 PATH 目錄，不含相對 "." / cwd 候選
    expect(calls.every((c) => c.startsWith('C:\\real-tools'))).toBe(true);
    expect(calls.some((c) => c === 'gopls' || c.startsWith('.\\') || c.startsWith('./'))).toBe(false);
  });
});
