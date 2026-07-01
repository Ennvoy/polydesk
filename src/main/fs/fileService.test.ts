// F-4 fileService 單元測試（真實 fs temp + 真實 WorkspaceManager/StateStore，無 mock）。
// 覆蓋紅軍：A1 路徑越界沙箱、A2 編碼偵測 round-trip、A3 EOL/BOM 保真、A4 衝突+原子寫、A5 大檔/特殊檔；
// 另含契約要求的 Big5/CRLF round-trip 與唯讀檔權限錯誤。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  utimesSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import {
  readFileSafe,
  writeFileSafe,
  detectEncoding,
  resolveSafe,
  importFiles,
  deleteEntry,
  readSheet,
  __resetFileServiceState,
} from './fileService';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-fs-'));
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  return { root, userData, mgr };
}

/** 在 root 下建一個資料夾並加為工作區，回傳 {dir, wsId}。 */
function addWorkspace(mgr: WorkspaceManager, root: string, name: string): { dir: string; wsId: string } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const res = mgr.add({ path: dir });
  if (!('id' in res)) throw new Error('add workspace 失敗');
  return { dir, wsId: res.id };
}

describe('fileService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    __resetFileServiceState();
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  // ── A1：路徑越界 / 沙箱逃逸 ──────────────────────────────────────────
  describe('A1 路徑沙箱（realpath + 邊界檢查，禁越界讀寫）', () => {
    it('相對逃逸 / 絕對路徑直用 / 前綴混淆 / UNC 全部拒絕，且不外洩工作區外內容', async () => {
      const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
      // 工作區外機密
      const outsideDir = join(ctx.root, 'outside');
      mkdirSync(outsideDir, { recursive: true });
      const secret = join(outsideDir, 'secret.key');
      writeFileSync(secret, 'TOPSECRET', 'utf8');

      // (a) 相對逃逸
      await expect(
        readFileSafe(ctx.mgr, { wsId, path: join('..', 'outside', 'secret.key') }),
      ).rejects.toThrow(/outside-workspace/);
      // (b) 絕對路徑直用（專測「path 已絕對則用之」分支）
      await expect(readFileSafe(ctx.mgr, { wsId, path: secret })).rejects.toThrow(/outside-workspace/);

      // (c) 前綴混淆：codeA vs codeA-evil（字串 startsWith 會誤放，realpath+relative 不會）
      const evil = join(ctx.root, 'codeA-evil');
      mkdirSync(evil, { recursive: true });
      writeFileSync(join(evil, 'x.txt'), 'EVIL', 'utf8');
      await expect(readFileSafe(ctx.mgr, { wsId, path: join(evil, 'x.txt') })).rejects.toThrow(
        /outside-workspace/,
      );

      // (d) UNC（避免 Windows 自動 SMB 認證外洩）
      await expect(
        readFileSafe(ctx.mgr, { wsId, path: '\\\\127.0.0.1\\share\\x' }),
      ).rejects.toThrow(/outside-workspace/);
    });

    it('workspace 內 junction 指向外部 → 讀其下檔案被拒（解 junction 後越界）', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeJ');
      const outsideDir = join(ctx.root, 'outsideJ');
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'secret.key'), 'TOPSECRET', 'utf8');
      let junctionMade = false;
      try {
        symlinkSync(outsideDir, join(dir, 'junc'), 'junction');
        junctionMade = true;
      } catch {
        /* 環境不支援 junction：略過此子案例（其餘 A1 已涵蓋越界） */
      }
      if (junctionMade) {
        await expect(
          readFileSafe(ctx.mgr, { wsId, path: join('junc', 'secret.key') }),
        ).rejects.toThrow(/outside-workspace/);
      }
    });

    it('fs:write 餵工作區外絕對路徑 → 拒絕且外部檔 byte 未被改動', async () => {
      const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeW');
      const outsideDir = join(ctx.root, 'outsideW');
      mkdirSync(outsideDir, { recursive: true });
      const victim = join(outsideDir, 'victim.txt');
      writeFileSync(victim, 'ORIGINAL', 'utf8');
      await expect(
        writeFileSafe(ctx.mgr, { wsId, path: victim, content: 'HACKED', encoding: 'utf-8', eol: 'lf' }),
      ).rejects.toThrow(/outside-workspace/);
      expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL');
    });

    it('resolveSafe 對工作區內合法路徑放行（絕對/相對皆可）', () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeOk');
      const inside = join(dir, 'sub', 'a.txt');
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(inside, 'hi', 'utf8');
      const rel = resolveSafe(ctx.mgr, wsId, join('sub', 'a.txt'));
      const abs = resolveSafe(ctx.mgr, wsId, inside);
      expect('ok' in rel).toBe(true);
      expect('ok' in abs).toBe(true);
    });
  });

  // ── A2：編碼偵測 + round-trip 不摧毀原始碼 ───────────────────────────
  describe('A2 編碼偵測（Big5 不誤判、低信心不靜默 re-encode）', () => {
    it('短 Big5 檔 → 偵測為 big5、解碼不亂碼、原封寫回 byte-identical', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'big5ws');
      const file = join(dir, 'big5.txt');
      const original = iconv.encode('測試\r\n程式碼', 'big5');
      writeFileSync(file, original);

      const r = await readFileSafe(ctx.mgr, { wsId, path: 'big5.txt' });
      expect(r.encoding).toBe('big5');
      expect(r.content).toBe('測試\r\n程式碼'); // 不亂碼
      expect(r.content.includes('�')).toBe(false); // 無替代字元

      const w = await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'big5.txt',
        content: r.content,
        encoding: r.encoding,
        eol: r.eol,
      });
      expect(w).toEqual({ ok: true });
      expect(readFileSync(file).equals(original)).toBe(true); // 磁碟 byte 完全相同
    });

    it('未對映/低信心位元組 → 不丟例外、預設 utf-8 且 lowConfidence=true（不靜默以錯編碼重寫）', async () => {
      // 'Hello' + windows-1252 右單引號(0x92) + '!'：非合法 UTF-8、結構也非 Big5
      const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x92, 0x21]);
      const det = detectEncoding(buf);
      expect(det.encoding).toBe('utf-8');
      expect(det.lowConfidence).toBe(true);

      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'lowconf');
      const file = join(dir, 'amb.txt');
      writeFileSync(file, buf);
      const r = await readFileSafe(ctx.mgr, { wsId, path: 'amb.txt' }); // 不丟例外
      expect(r.encoding).toBe('utf-8');
    });

    it('純 ASCII 與含中文 UTF-8 皆偵測為 utf-8', () => {
      expect(detectEncoding(Buffer.from('plain ascii\n', 'utf8')).encoding).toBe('utf-8');
      const zh = detectEncoding(Buffer.from('繁體中文 UTF-8\n', 'utf8'));
      expect(zh.encoding).toBe('utf-8');
      expect(zh.lowConfidence).toBe(false);
    });
  });

  // ── A3：EOL / BOM 保真，禁全域正規化 ────────────────────────────────
  describe('A3 EOL/BOM 保真（混合換行不被改寫、BOM 不重複/遺失）', () => {
    it('混合 EOL 檔 read→write byte-identical（不全域正規化）', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'eolws');
      const file = join(dir, 'mixed.txt');
      const original = Buffer.from('a\r\nb\nc\r\n', 'latin1');
      writeFileSync(file, original);

      const r = await readFileSafe(ctx.mgr, { wsId, path: 'mixed.txt' });
      expect(r.content).toBe('a\r\nb\nc\r\n'); // content 不被改
      expect(r.eol).toBe('crlf');

      await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'mixed.txt',
        content: r.content,
        encoding: r.encoding,
        eol: r.eol,
      });
      expect(readFileSync(file).equals(original)).toBe(true); // 混合 EOL 完整保留
    });

    it('utf-8-bom：read 剝 BOM、write 補回恰好一個 BOM', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'bomws');
      const file = join(dir, 'bom.txt');
      const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello\nworld\n', 'utf8')]);
      writeFileSync(file, original);

      const r = await readFileSafe(ctx.mgr, { wsId, path: 'bom.txt' });
      expect(r.encoding).toBe('utf-8-bom');
      expect(r.content.charCodeAt(0)).not.toBe(0xfeff); // content 不含前導 BOM
      expect(r.content).toBe('hello\nworld\n');

      await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'bom.txt',
        content: r.content,
        encoding: r.encoding,
        eol: r.eol,
      });
      const out = readFileSync(file);
      // 恰好一個 BOM：前三 byte 是 BOM，第二段不是
      expect(out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf).toBe(true);
      expect(out[3] === 0xef && out[4] === 0xbb && out[5] === 0xbf).toBe(false);
      expect(out.equals(original)).toBe(true);
    });
  });

  // ── A4：衝突偵測（lost-update）+ 原子寫（torn write） ────────────────
  describe('A4 衝突偵測 + 原子寫', () => {
    it('lost-update：交付後外部改檔 → 寫回回 conflict，磁碟仍為外部版本', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'conflictws');
      const file = join(dir, 'c.txt');
      writeFileSync(file, 'v1', 'utf8');

      await readFileSafe(ctx.mgr, { wsId, path: 'c.txt' }); // 記下交付版本

      // 外部修改 + 明確 bump mtime（避免同毫秒解析度誤判）
      writeFileSync(file, 'v2-external', 'utf8');
      const future = new Date(Date.now() + 10_000);
      utimesSync(file, future, future);

      const w = await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'c.txt',
        content: 'v3-mine',
        encoding: 'utf-8',
        eol: 'lf',
      });
      expect(w).toEqual({ error: 'conflict' });
      expect(readFileSync(file, 'utf8')).toBe('v2-external'); // 未被蓋
    });

    it('併發寫同一新檔 → 結果為其中之一的完整內容，永不截斷/空檔', async () => {
      const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'tornws');
      const X = 'X'.repeat(200_000);
      const Y = 'Y'.repeat(200_000);
      await Promise.all([
        writeFileSafe(ctx.mgr, { wsId, path: 'torn.txt', content: X, encoding: 'utf-8', eol: 'lf' }),
        writeFileSafe(ctx.mgr, { wsId, path: 'torn.txt', content: Y, encoding: 'utf-8', eol: 'lf' }),
      ]);
      const out = readFileSync(join(ctx.root, 'tornws', 'torn.txt'), 'utf8');
      expect(out.length).toBe(200_000); // 非截斷、非空
      expect(out === X || out === Y).toBe(true); // 完整的其中之一
    });

    it('首次寫新檔（未曾讀過）正常成功，不誤判 conflict', async () => {
      const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'newws');
      const w = await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'fresh.txt',
        content: 'brand new',
        encoding: 'utf-8',
        eol: 'lf',
      });
      expect(w).toEqual({ ok: true });
      expect(readFileSync(join(ctx.root, 'newws', 'fresh.txt'), 'utf8')).toBe('brand new');
    });
  });

  // ── A5：大檔 / 非一般檔不致 OOM / EISDIR / 卡死 ─────────────────────
  describe('A5 無界讀取防護', () => {
    it('超過大小門檻 → too-large（讀前擋，不整檔載入）', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'bigws');
      const file = join(dir, 'big.bin');
      writeFileSync(file, Buffer.alloc(2048, 0x61)); // 2KB
      await expect(
        readFileSafe(ctx.mgr, { wsId, path: 'big.bin' }, { maxBytes: 1024 }),
      ).rejects.toThrow(/too-large/);
    });

    it('對目錄呼叫 read → 乾淨 not-a-file（不丟未捕捉例外、不無限 await）', async () => {
      const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'dirws');
      mkdirSync(join(dir, 'subdir'), { recursive: true });
      await expect(readFileSafe(ctx.mgr, { wsId, path: 'subdir' })).rejects.toThrow(/not-a-file/);
    });

    it('讀不存在檔 → 乾淨 not-found', async () => {
      const { wsId } = addWorkspace(ctx.mgr, ctx.root, 'nfws');
      await expect(readFileSafe(ctx.mgr, { wsId, path: 'nope.txt' })).rejects.toThrow(/not-found/);
    });
  });

  // ── 契約：唯讀檔權限錯誤 ────────────────────────────────────────────
  it('唯讀檔寫入 → {error:"permission"}（不假裝成功）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'rows');
    const file = join(dir, 'ro.txt');
    writeFileSync(file, 'locked', 'utf8');
    chmodSync(file, 0o444);
    try {
      const w = await writeFileSafe(ctx.mgr, {
        wsId,
        path: 'ro.txt',
        content: 'overwrite',
        encoding: 'utf-8',
        eol: 'lf',
      });
      expect(w).toEqual({ error: 'permission' });
      expect(readFileSync(file, 'utf8')).toBe('locked'); // 內容未變
    } finally {
      chmodSync(file, 0o666); // 還原以利清理
    }
  });

  // ── 契約：CRLF round-trip 保留 ──────────────────────────────────────
  it('CRLF 純 UTF-8 檔 read 回 crlf、write 回去仍 CRLF', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'crlfws');
    const file = join(dir, 'crlf.ts');
    const original = Buffer.from('const a = 1;\r\nconst b = 2;\r\n', 'utf8');
    writeFileSync(file, original);
    const r = await readFileSafe(ctx.mgr, { wsId, path: 'crlf.ts' });
    expect(r.eol).toBe('crlf');
    expect(r.encoding).toBe('utf-8');
    await writeFileSafe(ctx.mgr, { wsId, path: 'crlf.ts', content: r.content, encoding: r.encoding, eol: r.eol });
    expect(readFileSync(file).equals(original)).toBe(true);
  });
});

// ── importFiles：從系統剪貼簿貼入外部檔案（VSCode 風 Ctrl+V）──────────────
describe('fileService importFiles（貼上外部檔案）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    __resetFileServiceState();
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('多個工作區外檔案複製進根目錄，含中文檔名', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    const ext = join(ctx.root, 'external');
    mkdirSync(ext, { recursive: true });
    const a = join(ext, '報告.txt');
    const b = join(ext, 'photo.png');
    writeFileSync(a, 'AAA', 'utf8');
    writeFileSync(b, 'PNG', 'utf8');

    const r = await importFiles(ctx.mgr, wsId, '', [a, b]);
    expect('imported' in r ? r.imported : -1).toBe(2);
    expect(readFileSync(join(dir, '報告.txt'), 'utf8')).toBe('AAA');
    expect(readFileSync(join(dir, 'photo.png'), 'utf8')).toBe('PNG');
  });

  it('同名檔自動改名（name copy.ext → name copy 2.ext），不覆蓋既有', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    writeFileSync(join(dir, 'a.txt'), 'ORIG', 'utf8');
    const ext = join(ctx.root, 'external');
    mkdirSync(ext, { recursive: true });
    const src = join(ext, 'a.txt');
    writeFileSync(src, 'NEW', 'utf8');

    const r = await importFiles(ctx.mgr, wsId, '', [src]);
    expect('names' in r ? r.names : []).toEqual(['a copy.txt']);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('ORIG'); // 原檔不被覆蓋
    expect(readFileSync(join(dir, 'a copy.txt'), 'utf8')).toBe('NEW');

    const r2 = await importFiles(ctx.mgr, wsId, '', [src]);
    expect('names' in r2 ? r2.names : []).toEqual(['a copy 2.txt']);
  });

  it('貼入子資料夾當目標，遞迴複製整個資料夾', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const ext = join(ctx.root, 'external');
    mkdirSync(join(ext, 'folder'), { recursive: true });
    writeFileSync(join(ext, 'folder', 'inner.txt'), 'IN', 'utf8');

    const r = await importFiles(ctx.mgr, wsId, 'sub', [join(ext, 'folder')]);
    expect('imported' in r ? r.imported : -1).toBe(1);
    expect(readFileSync(join(dir, 'sub', 'folder', 'inner.txt'), 'utf8')).toBe('IN');
  });

  it('destDir 越界 / 非資料夾一律拒（沙箱）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    const ext = join(ctx.root, 'external');
    mkdirSync(ext, { recursive: true });
    const src = join(ext, 'x.txt');
    writeFileSync(src, 'X', 'utf8');

    const outside = await importFiles(ctx.mgr, wsId, '../outside', [src]);
    expect('error' in outside).toBe(true);

    writeFileSync(join(dir, 'file.txt'), 'F', 'utf8');
    const notDir = await importFiles(ctx.mgr, wsId, 'file.txt', [src]);
    expect('error' in notDir).toBe(true);
  });
});

// ── deleteEntry：symlink/junction 不跟隨（codex P1-1）─────────────────────
describe('fileService deleteEntry（symlink 不跟隨葉節點）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    __resetFileServiceState();
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('刪 junction 只刪連結本身、不跟隨到目標內容', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    mkdirSync(join(dir, 'real'), { recursive: true });
    writeFileSync(join(dir, 'real', 'keep.txt'), 'KEEP', 'utf8');
    symlinkSync(join(dir, 'real'), join(dir, 'link'), 'junction'); // workspace 內 junction → real/

    const r = await deleteEntry(ctx.mgr, wsId, 'link');
    expect('ok' in r).toBe(true);
    expect(existsSync(join(dir, 'link'))).toBe(false); // 連結被刪
    expect(readFileSync(join(dir, 'real', 'keep.txt'), 'utf8')).toBe('KEEP'); // 目標內容完好、未被跟隨刪掉
  });
});

// ── readSheet：xlsx 唯讀表格預覽 ──────────────────────────────────────────
describe('fileService readSheet（xlsx 表格預覽）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    __resetFileServiceState();
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('解析 xlsx 成工作表儲存格矩陣（含中文、多工作表、數字轉字串）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['姓名', '分數'], ['小明', 90], ['小華', 85]]), '成績');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['項目'], ['備註']]), '其他');
    XLSX.writeFile(wb, join(dir, 'data.xlsx'));

    const r = await readSheet(ctx.mgr, wsId, 'data.xlsx');
    expect('sheets' in r).toBe(true);
    if ('sheets' in r) {
      expect(r.sheets.map((s) => s.name)).toEqual(['成績', '其他']);
      expect(r.sheets[0].rows[0]).toEqual(['姓名', '分數']);
      expect(r.sheets[0].rows[1]).toEqual(['小明', '90']); // 數字→字串
      expect(r.sheets[0].rows[2]).toEqual(['小華', '85']);
    }
  });

  it('越界路徑拒；壞檔不崩（try/catch 保證 return）', async () => {
    const { dir, wsId } = addWorkspace(ctx.mgr, ctx.root, 'codeA');
    expect('error' in (await readSheet(ctx.mgr, wsId, '../secret.xlsx'))).toBe(true);
    writeFileSync(join(dir, 'bad.xlsx'), 'not a real xlsx', 'utf8');
    const bad = await readSheet(ctx.mgr, wsId, 'bad.xlsx'); // 不應 throw
    expect(bad).toBeDefined();
  });
});
