// F-8 processProbe 單元測試（注入式 spawn / 受控程序清單 + 真實樹演算法、parse、安全硬化）。
// 紅軍：
//   A1 spawn 絕對路徑 + shell:false + 安全 cwd(!=workspace) + 白名單 env；半可信 workspace 內 sentinel
//      powershell.exe 永不被呼叫。
//   A2 null name/cmd（System/Idle、無權讀程序）不丟例外、一律當不匹配。
//   A3 (a) cmd 子字串/路徑含 claude 不誤判（須 argv0 token）；(b) root 子樹外的 claude.exe 不歸戶。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import {
  createProcessLister,
  parseProcessJson,
  matchClaude,
  isClaudeProcess,
  powershellAbsolutePath,
  safeProbeEnv,
  type ProcessInfo,
  type ProbeChildProcess,
  type ProbeSpawnFn,
  type ProbeSpawnOptions,
} from './processProbe';

type FakeChild = ProbeChildProcess & {
  emitData(b: Buffer): void;
  emitClose(c: number | null): void;
  emitError(e: Error): void;
  readonly killCount: number;
};

/** 可手動驅動 data/close/error 的 fake child（不執行任何真實程序）。 */
function makeFakeChild(): FakeChild {
  let dataCb: ((c: Buffer) => void) | null = null;
  let closeCb: ((code: number | null) => void) | null = null;
  let errCb: ((e: Error) => void) | null = null;
  let killed = 0;
  const api = {
    stdout: {
      on(_event: 'data', cb: (c: Buffer) => void): void {
        dataCb = cb;
      },
    },
    on(event: string, cb: (arg: never) => void) {
      if (event === 'close') closeCb = cb as unknown as (code: number | null) => void;
      else if (event === 'error') errCb = cb as unknown as (e: Error) => void;
      return api;
    },
    kill(): boolean {
      killed += 1;
      return true;
    },
    emitData: (b: Buffer): void => dataCb?.(b),
    emitClose: (c: number | null): void => closeCb?.(c),
    emitError: (e: Error): void => errCb?.(e),
    get killCount(): number {
      return killed;
    },
  };
  return api as unknown as FakeChild;
}

describe('processProbe — spawn 安全硬化（F-8-A1）', () => {
  let safeRoot: string;
  let wsDir: string;
  let sentinel: string;
  const SECRET_KEY = 'POLYDESK_PROBE_SECRET';

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-probe-a1-'));
    safeRoot = join(tmp, 'WindowsSafe');
    wsDir = join(tmp, 'half-trusted-workspace');
    mkdirSync(safeRoot, { recursive: true });
    mkdirSync(wsDir, { recursive: true });
    // 攻擊者在半可信 workspace 根放惡意 powershell.exe（bare-name spawn + cwd 落在此即被執行）
    sentinel = join(wsDir, 'powershell.exe');
    writeFileSync(sentinel, 'malicious');
    process.env[SECRET_KEY] = 'topsecret';
    process.env.GIT_ASKPASS = 'evil-askpass';
  });
  afterEach(() => {
    delete process.env[SECRET_KEY];
    delete process.env.GIT_ASKPASS;
    rmSync(join(safeRoot, '..'), { recursive: true, force: true });
  });

  it('以絕對路徑 powershell.exe + shell:false + 安全 cwd(!=workspace) + 白名單 env spawn；sentinel 永不被呼叫', async () => {
    const calls: { file: string; args: readonly string[]; opts: ProbeSpawnOptions }[] = [];
    let child: ReturnType<typeof makeFakeChild> | null = null;
    const spawn: ProbeSpawnFn = (file, args, opts) => {
      calls.push({ file, args, opts });
      child = makeFakeChild();
      return child;
    };
    // 不傳 cwd → 應預設為 systemRoot（安全目錄），絕不採 workspace.path
    const lister = createProcessLister({ spawn, systemRoot: safeRoot });
    const p = lister();
    // 列舉器已 spawn 並掛上監聽 → 驅動回應
    expect(child).not.toBeNull();
    child!.emitData(Buffer.from(JSON.stringify([{ ProcessId: 1, ParentProcessId: 0, Name: 'a', CommandLine: null }])));
    child!.emitClose(0);
    const result = await p;

    expect(calls).toHaveLength(1);
    const c = calls[0];
    // (1) 絕對路徑 system powershell；不得是 bare 'powershell' 或 workspace 內 sentinel
    expect(c.file).toBe(powershellAbsolutePath(safeRoot));
    expect(isAbsolute(c.file)).toBe(true);
    expect(c.file).not.toBe('powershell');
    expect(c.file).not.toBe('powershell.exe');
    expect(c.file).not.toBe(sentinel);
    // (2) shell:false
    expect(c.opts.shell).toBe(false);
    // (3) cwd 為安全目錄且不等於 workspace
    expect(c.opts.cwd).toBe(safeRoot);
    expect(c.opts.cwd).not.toBe(wsDir);
    // (4) env 白名單最小集：無 GIT_* / 任意繼承機密、有 SystemRoot
    expect(c.opts.env.SystemRoot).toBe(safeRoot);
    expect(c.opts.env[SECRET_KEY]).toBeUndefined();
    expect(c.opts.env.GIT_ASKPASS).toBeUndefined();
    // 解析正常
    expect(result).toEqual([{ pid: 1, ppid: 0, name: 'a', cmd: null }]);
  });

  it('safeProbeEnv 不含 GIT_* / 任意繼承變數（白名單）', () => {
    const env = safeProbeEnv(safeRoot);
    expect(env.SystemRoot).toBe(safeRoot);
    expect(env[SECRET_KEY]).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual(['PATHEXT', 'SystemRoot', 'windir']);
  });

  it('spawn 失敗（ENOENT）→ reject（不假裝成功）', async () => {
    let child: ReturnType<typeof makeFakeChild> | null = null;
    const spawn: ProbeSpawnFn = () => {
      child = makeFakeChild();
      return child;
    };
    const lister = createProcessLister({ spawn, systemRoot: safeRoot });
    const p = lister();
    child!.emitError(new Error('spawn ENOENT'));
    await expect(p).rejects.toThrow(/ENOENT/);
  });

  it('子程序逾時 → kill + reject（WMI hang 不卡死）', async () => {
    let child: ReturnType<typeof makeFakeChild> | null = null;
    const spawn: ProbeSpawnFn = () => {
      child = makeFakeChild();
      return child; // 永不 emitClose → 觸發逾時
    };
    const lister = createProcessLister({ spawn, systemRoot: safeRoot, timeoutMs: 30 });
    await expect(lister()).rejects.toThrow(/逾時/);
    expect(child!.killCount).toBeGreaterThanOrEqual(1);
  });
});

describe('processProbe — parseProcessJson（容錯）', () => {
  it('陣列輸出正常解析、coerce 數字', () => {
    const raw = JSON.stringify([
      { ProcessId: 100, ParentProcessId: 4, Name: 'powershell.exe', CommandLine: 'powershell.exe' },
      { ProcessId: '101', ParentProcessId: '100', Name: 'claude.exe', CommandLine: 'claude.exe' },
    ]);
    expect(parseProcessJson(raw)).toEqual([
      { pid: 100, ppid: 4, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 101, ppid: 100, name: 'claude.exe', cmd: 'claude.exe' },
    ]);
  });

  it('單一程序（PowerShell 回物件非陣列）也解析', () => {
    const raw = JSON.stringify({ ProcessId: 7, ParentProcessId: 1, Name: 'x', CommandLine: 'x' });
    expect(parseProcessJson(raw)).toEqual([{ pid: 7, ppid: 1, name: 'x', cmd: 'x' }]);
  });

  it('null/缺欄降級：cmd/name 非字串→null、ppid 缺→0、pid 缺→跳過；空字串→[]', () => {
    const raw = JSON.stringify([
      { ProcessId: 0, ParentProcessId: 0, Name: 'Idle', CommandLine: null },
      { ProcessId: 4, Name: 'System' }, // 缺 ParentProcessId / CommandLine
      { ParentProcessId: 1, Name: 'no-pid', CommandLine: 'x' }, // 缺 ProcessId → 跳過
    ]);
    expect(parseProcessJson(raw)).toEqual([
      { pid: 0, ppid: 0, name: 'Idle', cmd: null },
      { pid: 4, ppid: 0, name: 'System', cmd: null },
    ]);
    expect(parseProcessJson('')).toEqual([]);
    expect(parseProcessJson('not json')).toEqual([]);
  });
});

describe('matchClaude — null 欄位強韌性（F-8-A2）', () => {
  it('混雜清單含 System/Idle(null cmd) 與 null name 的 claude → 不丟例外、回合法結果', () => {
    const procs: ProcessInfo[] = [
      { pid: 0, ppid: 0, name: 'Idle', cmd: null },
      { pid: 4, ppid: 0, name: 'System', cmd: null },
      { pid: 500, ppid: 1, name: 'powershell.exe', cmd: null }, // root shell，cmd 無權讀
      { pid: 501, ppid: 500, name: null, cmd: 'claude.exe --resume' }, // claude，name 缺
      { pid: 502, ppid: 501, name: null, cmd: null }, // claude 之子，全 null
    ];
    expect(() => matchClaude([500], procs)).not.toThrow();
    const r = matchClaude([500], procs);
    expect(r.claudePids).toEqual([501]);
    expect(r.hasActiveChildren).toBe(true); // 502 是 501 的子程序
  });

  it('isClaudeProcess 對 null name/cmd 一律 false（不丟例外）', () => {
    expect(isClaudeProcess({ pid: 1, ppid: 0, name: null, cmd: null })).toBe(false);
    expect(isClaudeProcess({ pid: 1, ppid: 0, name: 'System', cmd: null })).toBe(false);
  });
});

describe('matchClaude — 比對綁 token + root 子樹（F-8-A3）', () => {
  it('(a) cmd 子字串/路徑含 claude 但 argv0 非 claude → 不誤判', () => {
    const procs: ProcessInfo[] = [
      { pid: 600, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' }, // root
      { pid: 601, ppid: 600, name: 'node.exe', cmd: 'node claude-x.js' }, // argv0=node
      { pid: 602, ppid: 600, name: 'app.exe', cmd: 'C:\\claude\\app.exe --x' }, // argv0 結尾 app.exe
      { pid: 603, ppid: 600, name: 'git.exe', cmd: 'git commit -m "fix claude"' }, // argv0=git
      { pid: 604, ppid: 600, name: 'npm.cmd', cmd: 'npm run claude-test' }, // argv0=npm.cmd
    ];
    expect(matchClaude([600], procs)).toEqual({ claudePids: [], hasActiveChildren: false });
  });

  it('(a) 真 claude（argv0 結尾 claude(.exe/.cmd) 或引號包裹路徑）→ 命中', () => {
    const procs: ProcessInfo[] = [
      { pid: 610, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 611, ppid: 610, name: 'x', cmd: '"C:\\Users\\u\\AppData\\npm\\claude.cmd" --resume' },
    ];
    expect(matchClaude([610], procs).claudePids).toEqual([611]);
  });

  it('(b) name=claude.exe 但不在該 wsId root 子樹 → 仍 idle（不認全機任意 claude）', () => {
    const procs: ProcessInfo[] = [
      { pid: 700, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' }, // ws root
      { pid: 701, ppid: 700, name: 'node.exe', cmd: 'node server.js' },
      { pid: 900, ppid: 1, name: 'claude.exe', cmd: 'claude.exe' }, // 別處 claude，非 700 子孫
      { pid: 901, ppid: 900, name: 'rg.exe', cmd: 'rg foo' },
    ];
    expect(matchClaude([700], procs)).toEqual({ claudePids: [], hasActiveChildren: false });
  });
});

describe('matchClaude — 三態原語（idle/running/stopped-await）', () => {
  const ROOT = 200;
  it('無 claude → claudePids 空（→ idle）', () => {
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'node.exe', cmd: 'node x.js' },
    ];
    expect(matchClaude([ROOT], procs).claudePids).toEqual([]);
  });

  it('claude 有子程序 → hasActiveChildren=true（→ running）', () => {
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'claude.exe', cmd: 'claude.exe' },
      { pid: 202, ppid: 201, name: 'rg.exe', cmd: 'rg --json foo' },
    ];
    const r = matchClaude([ROOT], procs);
    expect(r.claudePids).toEqual([201]);
    expect(r.hasActiveChildren).toBe(true);
  });

  it('claude 無子程序 → hasActiveChildren=false（→ stopped-await）', () => {
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'claude.exe', cmd: 'claude.exe' },
    ];
    const r = matchClaude([ROOT], procs);
    expect(r.claudePids).toEqual([201]);
    expect(r.hasActiveChildren).toBe(false);
  });

  it('深層子樹：claude 為孫程序仍命中', () => {
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 210, ppid: 200, name: 'cmd.exe', cmd: 'cmd.exe' },
      { pid: 211, ppid: 210, name: 'claude.exe', cmd: 'claude.exe' },
    ];
    expect(matchClaude([ROOT], procs).claudePids).toEqual([211]);
  });
});
