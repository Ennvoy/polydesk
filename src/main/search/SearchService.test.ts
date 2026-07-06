// F-6 SearchService 單元測試（真 rg + 真 temp 目錄；A4 以注入式 spawn + 真實收斂演算法）。
// 涵蓋紅軍：
//  A1 env/arg 隔離（RIPGREP_CONFIG_PATH 剝除 + `--` 開頭 query 不被當 flag）— 真 rg。
//  A2 取代沙箱（junction 逃逸 skip）+ 衝突偵測（讀後外部改檔 → conflict 不覆蓋）— 真 fs。
//  A3 編碼保真（Big5+CRLF 只換命中片段、其餘 byte 不變）+ NUL 二進位 skip — 真 fs。
//  A4 search-as-you-type 收斂（存活 child ≤1、Map 清空、cancel 後不 emit、killByOwner）— 注入 spawn。
//  A5 巨大單行不無界成長 + preview 上限 + ENOENT/0命中 仍收斂 done — 真 rg + 注入 spawn。
// 另含 REQ-SEARCH-001/002/003/004：串流 path/line 正確、略過 node_modules、超量 truncated。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn as realSpawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  utimesSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { detectEncoding, __resetFileServiceState } from '../fs/fileService';
import {
  SearchService,
  collectReplacements,
  applyReplacements,
  applyReplacement,
  toUnpackedPath,
  fileNameMatches,
  type SearchDeps,
  type SearchSpawnFn,
  type SearchChild,
} from './SearchService';
import type { EventChannels } from '../../shared/ipc';
import type { SearchHit } from '../../shared/types';

type ResultPayload = EventChannels['search:result'];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-search-'));
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  return { root, userData, mgr };
}

function addWorkspace(mgr: WorkspaceManager, root: string, name: string): { dir: string; wsId: string } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const res = mgr.add({ path: dir });
  if (!('id' in res)) throw new Error('add workspace 失敗');
  return { dir, wsId: res.id };
}

/** 包一個收集結果 + 可等待 done 的 SearchService。 */
function makeService(mgr: WorkspaceManager, deps: SearchDeps = {}) {
  const results: ResultPayload[] = [];
  const waiters: { id: string; resolve: (p: ResultPayload) => void }[] = [];
  const onResult = (p: ResultPayload): void => {
    results.push(p);
    if (p.done) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].id === p.searchId) {
          waiters[i].resolve(p);
          waiters.splice(i, 1);
        }
      }
    }
  };
  const svc = new SearchService(mgr, { onResult, ...deps });
  const waitDone = (searchId: string, ms = 20_000): Promise<ResultPayload> =>
    new Promise((resolve, reject) => {
      const existing = results.find((r) => r.searchId === searchId && r.done);
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => reject(new Error('等待 done 逾時')), ms);
      waiters.push({
        id: searchId,
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
      });
    });
  const hitsFor = (searchId: string): SearchHit[] =>
    results.filter((r) => r.searchId === searchId).flatMap((r) => r.hits);
  return { svc, results, waitDone, hitsFor };
}

/** 注入式 fake child（真 EventEmitter，記 kill；測 A4 收斂演算法、A5 累加器邊界）。 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function makeFakeSpawn() {
  const children: FakeChild[] = [];
  const spawn: SearchSpawnFn = () => {
    const c = new FakeChild();
    children.push(c);
    return c as unknown as SearchChild;
  };
  return { children, spawn };
}

/**
 * 等注入式 fake spawn 真的被呼叫：spawnSearch() 在 `await getRgBin()` 之後才呼叫 spawnFn，
 * 故 run() 回傳後 child 不會同步出現。注入 rgPath 時 getRgBin 走 Promise.resolve（純 microtask），
 * 這裡 drain microtask 直到 child 數達標（@vscode/ripgrep 真正的 dynamic import 才需要 macrotask）。
 */
async function waitForChildren(children: FakeChild[], count: number): Promise<void> {
  for (let i = 0; i < 200 && children.length < count; i++) await Promise.resolve();
  if (children.length < count) {
    throw new Error(`等不到 ${count} 個注入 child（目前 ${children.length}）`);
  }
}

/** 組一條 rg 輸出行（path\0line:col:text\n），避免在原始碼放裸 NUL。 */
function matchLine(path: string, line: number, col: number, text: string): Buffer {
  return Buffer.concat([Buffer.from(path), Buffer.from([0]), Buffer.from(`${line}:${col}:${text}\n`)]);
}

describe('SearchService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    __resetFileServiceState();
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  // ── REQ-SEARCH-001/002：串流命中 path/line 正確（真 rg）──────────────
  it('串流回相對 POSIX path、正確 line 與含 query 的 preview（REQ-E2E-006）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'code.txt'), 'line one\nline two\nhas needle here\nline four\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr);
    const { searchId } = svc.run({ wsId, query: 'needle', opts: {} });
    await waitDone(searchId);

    const hits = hitsFor(searchId);
    const hit = hits.find((h) => h.path === 'sub/code.txt');
    expect(hit).toBeTruthy();
    expect(hit?.line).toBe(3);
    expect(hit?.preview.includes('needle')).toBe(true);
  });

  // ── REQ-SEARCH-003：略過 node_modules（真 rg，驗 --glob 排除）────────
  it('預設略過 node_modules，仍找到一般檔', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeIgnore');
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.txt'), 'needle in src\n', 'utf8');
    writeFileSync(join(dir, 'node_modules', 'dep', 'b.txt'), 'needle in dep\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr);
    const { searchId } = svc.run({ wsId, query: 'needle', opts: {} });
    await waitDone(searchId);

    const hits = hitsFor(searchId);
    expect(hits.some((h) => h.path === 'src/a.txt')).toBe(true);
    expect(hits.every((h) => !h.path.includes('node_modules'))).toBe(true);
  });

  // ── REQ-SEARCH-004：超量截斷（真 rg）────────────────────────────────
  it('命中超過 resultLimit → 最終事件 truncated:true 且總 hits === limit', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeMany');
    const lines = Array.from({ length: 80 }, (_, i) => `needle line ${i}`).join('\n');
    writeFileSync(join(dir, 'many.txt'), lines + '\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr, { resultLimit: 10, batchSize: 5 });
    const { searchId } = svc.run({ wsId, query: 'needle', opts: {} });
    const done = await waitDone(searchId);

    expect(done.truncated).toBe(true);
    expect(hitsFor(searchId).length).toBe(10);
  });

  // ── A1：env / arg 隔離（真 rg）──────────────────────────────────────
  it('A1：spawn rg 的 env 不含 RIPGREP_CONFIG_PATH，惡意 config 不生效', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeEnv');
    writeFileSync(join(dir, 'a.txt'), 'find needle here\n', 'utf8');

    // 惡意 rg config：若被讀到會 --glob 排除一切 → 0 命中（功能代理：證明 config 有/沒被讀）。
    const cfg = join(ctx.root, 'evil.rgcfg');
    writeFileSync(cfg, '--glob=!**/*\n', 'utf8');
    const prev = process.env.RIPGREP_CONFIG_PATH;
    process.env.RIPGREP_CONFIG_PATH = cfg;

    const capturedEnvs: NodeJS.ProcessEnv[] = [];
    const capturing: SearchSpawnFn = (file, args, opts) => {
      capturedEnvs.push(opts.env);
      return realSpawn(file, [...args], { cwd: opts.cwd, env: opts.env, windowsHide: true }) as unknown as SearchChild;
    };
    try {
      const { svc, waitDone, hitsFor } = makeService(ctx.mgr, { spawn: capturing });
      const { searchId } = svc.run({ wsId, query: 'needle', opts: {} });
      await waitDone(searchId);

      // config 未生效 → 仍找到命中
      expect(hitsFor(searchId).length).toBeGreaterThanOrEqual(1);
      // 傳給 rg 的 env 完全不含 RIPGREP_CONFIG_PATH / 任何 RIPGREP_*
      expect(capturedEnvs.length).toBeGreaterThanOrEqual(1);
      for (const env of capturedEnvs) {
        expect(env.RIPGREP_CONFIG_PATH).toBeUndefined();
        expect(Object.keys(env).some((k) => k.toUpperCase().startsWith('RIPGREP'))).toBe(false);
      }
    } finally {
      if (prev === undefined) delete process.env.RIPGREP_CONFIG_PATH;
      else process.env.RIPGREP_CONFIG_PATH = prev;
    }
  });

  it('A1：以 `--` 開頭的 query 被當字面搜尋（-e/-- 隔離），不被當 flag', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeDash');
    writeFileSync(join(dir, 'f.txt'), 'alpha --foo beta\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr);
    const { searchId } = svc.run({ wsId, query: '--foo', opts: {} });
    await waitDone(searchId);

    const hits = hitsFor(searchId);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.preview.includes('--foo'))).toBe(true);
  });

  // ── A2：取代沙箱 + 衝突偵測（真 fs，直接測 collect/apply 真實演算法）──
  it('A2：命中檔經 junction 指向沙箱外 → skip 不覆寫外部檔；正常檔正確取代', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeJunc');
    const outside = join(ctx.root, 'outsideJunc');
    mkdirSync(outside, { recursive: true });
    const secret = join(outside, 'secret.txt');
    const secretBytes = Buffer.from('SECRET findme SECRET', 'utf8');
    writeFileSync(secret, secretBytes);
    writeFileSync(join(dir, 'normal.txt'), 'hello findme world', 'utf8');

    let junctionMade = false;
    try {
      symlinkSync(outside, join(dir, 'linkdir'), 'junction');
      junctionMade = true;
    } catch {
      /* 環境不支援 junction：仍驗正常檔取代路徑 */
    }

    const files = junctionMade ? ['linkdir/secret.txt', 'normal.txt'] : ['normal.txt'];
    const { plan, skipped } = await collectReplacements(ctx.mgr, wsId, files, 'findme', 'XXXX', {});
    const results = await applyReplacements(ctx.mgr, wsId, plan);

    // 正常檔正確取代
    expect(readFileSync(join(dir, 'normal.txt'), 'utf8')).toBe('hello XXXX world');
    expect(results.some((r) => r.rel === 'normal.txt' && r.status === 'replaced')).toBe(true);
    if (junctionMade) {
      // 外部機密檔 byte 完全不變、且被列為 skip(outside)
      expect(readFileSync(secret).equals(secretBytes)).toBe(true);
      expect(skipped.some((s) => s.rel === 'linkdir/secret.txt' && s.reason === 'outside')).toBe(true);
      expect(plan.some((p) => p.rel === 'linkdir/secret.txt')).toBe(false);
    }
  });

  it('A2：collect 後命中檔被外部改動 → apply 回 conflict 不覆蓋（lost-update）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeConflict');
    const file = join(dir, 'c.txt');
    writeFileSync(file, 'v1 findme tail', 'utf8');

    // 第一相：讀 + 規劃（seed readVersions 記下交付版本）
    const { plan } = await collectReplacements(ctx.mgr, wsId, ['c.txt'], 'findme', 'XXXX', {});
    expect(plan.length).toBe(1);

    // 外部改檔 + 明確 bump mtime（避免同毫秒誤判）
    writeFileSync(file, 'v2-external findme tail', 'utf8');
    const future = new Date(Date.now() + 10_000);
    utimesSync(file, future, future);

    // 第二相：寫回 → 衝突
    const results = await applyReplacements(ctx.mgr, wsId, plan);
    expect(results[0].status).toBe('skipped');
    expect(results[0].reason).toBe('conflict');
    expect(readFileSync(file, 'utf8')).toBe('v2-external findme tail'); // 未被蓋
  });

  // ── A3：編碼/換行保真 + NUL 二進位 skip（真 fs）──────────────────────
  it('A3：Big5 + CRLF 檔取代只換命中片段，編碼/換行/其餘 byte 完全保留', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeBig5');
    const file = join(dir, 'big5.txt');
    const originalText = '測試foo程式\r\n第二行內容\r\n';
    writeFileSync(file, iconv.encode(originalText, 'big5'));

    const { plan } = await collectReplacements(ctx.mgr, wsId, ['big5.txt'], 'foo', 'BAR', { caseSensitive: true });
    expect(plan[0].encoding).toBe('big5');
    expect(plan[0].eol).toBe('crlf');
    expect(plan[0].count).toBe(1);
    const results = await applyReplacements(ctx.mgr, wsId, plan);
    expect(results[0].status).toBe('replaced');

    const raw = readFileSync(file);
    const expectedText = '測試BAR程式\r\n第二行內容\r\n';
    expect(detectEncoding(raw).encoding).toBe('big5'); // 仍 big5
    expect(raw.equals(iconv.encode(expectedText, 'big5'))).toBe(true); // byte-faithful、僅命中片段換
    expect(iconv.decode(raw, 'big5')).toBe(expectedText); // CRLF + 中文不亂碼
  });

  it('A3：含 NUL 的疑似二進位檔 → skip(binary)，檔案 byte 不變', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeBin');
    const file = join(dir, 'bin.dat');
    const bytes = Buffer.concat([Buffer.from('findme'), Buffer.from([0]), Buffer.from('findme')]);
    writeFileSync(file, bytes);

    const { plan, skipped } = await collectReplacements(ctx.mgr, wsId, ['bin.dat'], 'findme', 'X', {});
    expect(plan.length).toBe(0);
    expect(skipped.some((s) => s.rel === 'bin.dat' && s.reason === 'binary')).toBe(true);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it('applyReplacement：非 regex 字面取代不解讀 $；regex 模式支援 $1 群組', () => {
    expect(applyReplacement('a foo b foo', 'foo', '$&!', { caseSensitive: true })).toEqual({
      next: 'a $&! b $&!',
      count: 2,
    });
    expect(applyReplacement('key=val', '(\\w+)=(\\w+)', '$2=$1', { regex: true, caseSensitive: true })).toEqual({
      next: 'val=key',
      count: 1,
    });
    // smart-case：全小寫 query 不區分大小寫
    expect(applyReplacement('Foo foo FOO', 'foo', 'x', {}).count).toBe(3);
  });

  // ── A4：收斂 / 生命週期（注入 spawn + 真實演算法）────────────────────
  // 每次搜尋 spawn 一組 2 個 rg（children[偶]=內容、children[奇]=檔名 --files）。
  it('A4：連續 5 次搜尋，任一時刻存活 rg ≤1 組，舊的被 kill，收斂後 Map 清空', async () => {
    const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeCap');
    const { children, spawn } = makeFakeSpawn();
    const { svc } = makeService(ctx.mgr, { spawn, rgPath: 'rg', maxConcurrent: 1 });

    // 慢打字節奏：每次搜尋的 rg 先真的 spawn 出來，下一次 run 的 enforceCap 才殺得到它。
    // （快打字時舊搜尋會在 spawn 前就被取消、根本不啟動 rg —— 同樣滿足「存活 ≤1 組」，更省。）
    for (let i = 0; i < 5; i++) {
      svc.run({ wsId, query: `x${i}`, opts: {} });
      await waitForChildren(children, (i + 1) * 2);
      expect(svc.activeCount).toBe(1); // 任一時刻存活搜尋 ≤1
      expect(children.filter((c) => !c.killed).length).toBe(2); // 存活 rg ≤1 組（內容＋檔名）
    }

    expect(children.length).toBe(10);
    expect(children[8].killed).toBe(false);
    expect(children[9].killed).toBe(false);
    expect(children.slice(0, 8).every((c) => c.killed)).toBe(true);
    expect(svc.activeCount).toBe(1);

    // 最新一組（內容＋檔名）都正常結束 → Map 清空（不殘留殭屍項）
    children[8].emit('close', 0);
    expect(svc.activeCount).toBe(1); // 檔名側未收斂前不 done
    children[9].emit('close', 0);
    expect(svc.activeCount).toBe(0);
  });

  it('A4：killByOwner 殺該 owner 的殘留 child（兩支都殺）並清 Map（webContents destroyed）', async () => {
    addWorkspace(ctx.mgr, ctx.root, 'codeOwner');
    const wsId = ctx.mgr.list()[0].id;
    const { children, spawn } = makeFakeSpawn();
    const { svc } = makeService(ctx.mgr, { spawn, rgPath: 'rg' });
    const owner = { id: 'wc-1' };

    svc.run({ wsId, query: 'x', opts: {} }, owner);
    await waitForChildren(children, 2);
    expect(svc.activeCount).toBe(1);
    svc.killByOwner(owner);
    expect(children.every((c) => c.killed)).toBe(true);
    expect(svc.activeCount).toBe(0);
  });

  it('A4：cancel 後不再 emit 任何事件（含 done），且對應兩支 child 都被 kill', async () => {
    addWorkspace(ctx.mgr, ctx.root, 'codeCancel');
    const wsId = ctx.mgr.list()[0].id;
    const { children, spawn } = makeFakeSpawn();
    const { svc, results } = makeService(ctx.mgr, { spawn, rgPath: 'rg', batchSize: 1 });

    const { searchId } = svc.run({ wsId, query: 'x', opts: {} });
    await waitForChildren(children, 2);
    const [content, files] = children;
    svc.cancel({ searchId });
    expect(content.killed).toBe(true);
    expect(files.killed).toBe(true);

    // 取消後才到的資料/結束事件一律被吞掉
    content.stdout.emit('data', matchLine('a.txt', 2, 3, 'hi'));
    content.emit('close', 0);
    files.emit('close', 0);
    await Promise.resolve();
    expect(results.filter((r) => r.searchId === searchId).length).toBe(0);
  });

  // ── A5：OOM 邊界 + done 可靠性 ──────────────────────────────────────
  it('A5：巨大單行（無換行超上限）被丟棄、不污染後續行；preview 受上限約束', async () => {
    addWorkspace(ctx.mgr, ctx.root, 'codeHuge');
    const wsId = ctx.mgr.list()[0].id;
    const { children, spawn } = makeFakeSpawn();
    const { svc, hitsFor } = makeService(ctx.mgr, {
      spawn,
      rgPath: 'rg',
      batchSize: 1,
      maxLineBytes: 1024,
      previewMax: 50,
    });

    const { searchId } = svc.run({ wsId, query: 'x', opts: {} });
    await waitForChildren(children, 2);
    const [child, filesChild] = children;

    // 2000 bytes 無換行無 NUL → 超過 maxLineBytes → 累加器丟棄
    child.stdout.emit('data', Buffer.alloc(2000, 0x61));
    // 接著一條正常行：若上一段未被丟棄，path 會被污染成 'aaa...f.txt'
    child.stdout.emit('data', matchLine('f.txt', 3, 4, 'hello'));
    // 超長 preview → 截斷到 previewMax
    child.stdout.emit('data', matchLine('g.txt', 1, 1, 'b'.repeat(100)));

    const hits = hitsFor(searchId);
    const fhit = hits.find((h) => h.line === 3);
    expect(fhit?.path).toBe('f.txt'); // 未被前段污染（累加器確實被丟棄）
    const ghit = hits.find((h) => h.path === 'g.txt');
    expect(ghit?.preview.length).toBe(50);

    child.emit('close', 0);
    filesChild.emit('close', 0);
    expect(svc.activeCount).toBe(0);
  });

  it('A5：rg 路徑無效（ENOENT）→ 仍收到 done:true（UI 不卡）', async () => {
    const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeEnoent');
    const { svc, waitDone } = makeService(ctx.mgr, { rgPath: join(ctx.root, 'no-such-rg.exe') });
    const { searchId } = svc.run({ wsId, query: 'x', opts: {} });
    const done = await waitDone(searchId);
    expect(done.done).toBe(true);
    expect(done.hits.length).toBe(0);
  });

  it('A5：0 命中（rg exit code 1）→ done:true 且非錯誤（UI 不卡）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeZero');
    writeFileSync(join(dir, 'a.txt'), 'hello world\n', 'utf8');
    const { svc, waitDone, hitsFor } = makeService(ctx.mgr);
    const { searchId } = svc.run({ wsId, query: 'zzz-not-present-xyz', opts: {} });
    const done = await waitDone(searchId);
    expect(done.done).toBe(true);
    expect(done.truncated).toBe(false);
    expect(hitsFor(searchId).length).toBe(0);
  });

  // ── 檔名搜尋（kind:'file'，真 rg --files）─────────────────────────────
  it('檔名含 query → kind:file 命中（smart-case、排除 node_modules），與內容命中共存', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeFname');
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'FindMe_notes.txt'), 'nothing here\n', 'utf8');
    writeFileSync(join(dir, 'other.txt'), 'hello findme world\n', 'utf8');
    writeFileSync(join(dir, 'node_modules', 'dep', 'findme.txt'), 'x\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr);
    const { searchId } = svc.run({ wsId, query: 'findme', opts: {} });
    await waitDone(searchId);

    const hits = hitsFor(searchId);
    const fileHit = hits.find((h) => h.kind === 'file');
    expect(fileHit?.path).toBe('src/FindMe_notes.txt'); // 全小寫 query 不分大小寫
    expect(fileHit?.preview).toBe('FindMe_notes.txt'); // preview = basename
    expect(fileHit?.line).toBe(1);
    expect(hits.some((h) => h.kind !== 'file' && h.path === 'other.txt')).toBe(true); // 內容命中共存
    expect(hits.every((h) => !h.path.includes('node_modules'))).toBe(true);
  });

  it('檔名命中達 fileHitLimit → 截到上限、整體 done 正常（內容搜尋不受影響）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeFcap');
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `hitname-${i}.txt`), 'zzz\n', 'utf8');
    writeFileSync(join(dir, 'body.txt'), 'hitname in content\n', 'utf8');

    const { svc, waitDone, hitsFor } = makeService(ctx.mgr, { fileHitLimit: 3 });
    const { searchId } = svc.run({ wsId, query: 'hitname', opts: {} });
    const done = await waitDone(searchId);

    expect(done.done).toBe(true);
    const hits = hitsFor(searchId);
    expect(hits.filter((h) => h.kind === 'file').length).toBe(3);
    expect(hits.some((h) => h.kind !== 'file' && h.path === 'body.txt')).toBe(true);
  });

  it('fileNameMatches：只比 basename、smart-case/caseSensitive 規則與內容搜尋一致', () => {
    expect(fileNameMatches('src/FindMe_notes.txt', 'findme', {})).toBe(true); // 全小寫→不分大小寫
    expect(fileNameMatches('src/FindMe_notes.txt', 'FindMe', {})).toBe(true); // 含大寫→區分且相符
    expect(fileNameMatches('src/FindMe_notes.txt', 'FINDME', {})).toBe(false); // 含大寫→區分且不符
    expect(fileNameMatches('src/FindMe_notes.txt', 'findme', { caseSensitive: true })).toBe(false);
    expect(fileNameMatches('findme-dir/plain.txt', 'findme', {})).toBe(false); // 目錄名不算檔名命中
  });

  it('空 query / 無工作區 → 立即收斂 done，不 spawn', async () => {
    const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeEmpty');
    const { children, spawn } = makeFakeSpawn();
    const { svc, waitDone } = makeService(ctx.mgr, { spawn });
    const r1 = svc.run({ wsId, query: '', opts: {} });
    const r2 = svc.run({ wsId: 'bogus', query: 'x', opts: {} });
    expect((await waitDone(r1.searchId)).done).toBe(true);
    expect((await waitDone(r2.searchId)).done).toBe(true);
    expect(children.length).toBe(0); // 完全沒 spawn
  });
});

describe('toUnpackedPath（打包 asar 虛擬路徑 → 實體 unpacked 路徑）', () => {
  it('app.asar 內的 rgPath 轉為 app.asar.unpacked（win 分隔符）', () => {
    expect(
      toUnpackedPath('C:\\P\\resources\\app.asar\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe'),
    ).toBe('C:\\P\\resources\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe');
  });
  it('posix 分隔符同樣轉換', () => {
    expect(toUnpackedPath('/o/resources/app.asar/node_modules/x/bin/rg')).toBe(
      '/o/resources/app.asar.unpacked/node_modules/x/bin/rg',
    );
  });
  it('開發模式（無 app.asar）路徑原樣不動', () => {
    const dev = 'C:\\proj\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe';
    expect(toUnpackedPath(dev)).toBe(dev);
  });
});
