// fs 編輯操作（create/rename/delete/copy）+ 安全（越界拒、不可刪根）單測。真實 fs temp + 真實 WorkspaceManager。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { createEntry, renameEntry, deleteEntry, copyEntry } from './fileService';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-fsedit-'));
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const dir = join(root, 'ws');
  mkdirSync(dir, { recursive: true });
  const res = mgr.add({ path: dir });
  if (!('id' in res)) throw new Error('add workspace 失敗');
  return { root, dir, mgr, wsId: res.id };
}

describe('fileService 編輯操作', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('createEntry：建檔/建資料夾/巢狀建檔（父自動建）；已存在則拒', async () => {
    expect(await createEntry(ctx.mgr, ctx.wsId, 'a.txt', false)).toEqual({ ok: true });
    expect(existsSync(join(ctx.dir, 'a.txt'))).toBe(true);
    expect(await createEntry(ctx.mgr, ctx.wsId, 'sub', true)).toEqual({ ok: true });
    expect(existsSync(join(ctx.dir, 'sub'))).toBe(true);
    expect(await createEntry(ctx.mgr, ctx.wsId, 'deep/x.txt', false)).toEqual({ ok: true });
    expect(existsSync(join(ctx.dir, 'deep', 'x.txt'))).toBe(true);
    expect('error' in (await createEntry(ctx.mgr, ctx.wsId, 'a.txt', false))).toBe(true); // 已存在
  });

  it('renameEntry：改名；目標已存在則拒', async () => {
    writeFileSync(join(ctx.dir, 'old.txt'), 'hi');
    expect(await renameEntry(ctx.mgr, ctx.wsId, 'old.txt', 'new.txt')).toEqual({ ok: true });
    expect(existsSync(join(ctx.dir, 'old.txt'))).toBe(false);
    expect(existsSync(join(ctx.dir, 'new.txt'))).toBe(true);
    writeFileSync(join(ctx.dir, 'taken.txt'), 'x');
    expect('error' in (await renameEntry(ctx.mgr, ctx.wsId, 'new.txt', 'taken.txt'))).toBe(true);
  });

  it('deleteEntry：刪檔；不可刪工作區根', async () => {
    writeFileSync(join(ctx.dir, 'del.txt'), 'x');
    // 注入真 fs 刪除當 trash：node 測試環境無 Electron shell（預設參數 shell.trashItem 會炸）；
    // deleteEntry 簽名本就為此留注入點，真回收桶鏈路由 e2e delete-trash.spec 以真 Electron 蓋。
    const trash = async (abs: string): Promise<void> => rmSync(abs, { recursive: true, force: true });
    expect(await deleteEntry(ctx.mgr, ctx.wsId, 'del.txt', trash)).toEqual({ ok: true });
    expect(existsSync(join(ctx.dir, 'del.txt'))).toBe(false);
    expect('error' in (await deleteEntry(ctx.mgr, ctx.wsId, '.', trash))).toBe(true); // 根不可刪
  });

  it('copyEntry：複製（來源保留）；目標已存在則拒', async () => {
    writeFileSync(join(ctx.dir, 'src.txt'), 'content');
    expect(await copyEntry(ctx.mgr, ctx.wsId, 'src.txt', 'dst.txt')).toEqual({ ok: true });
    expect(readFileSync(join(ctx.dir, 'dst.txt'), 'utf8')).toBe('content');
    expect(existsSync(join(ctx.dir, 'src.txt'))).toBe(true);
    expect('error' in (await copyEntry(ctx.mgr, ctx.wsId, 'src.txt', 'dst.txt'))).toBe(true);
  });

  it('安全：越界路徑（../）一律拒', async () => {
    expect('error' in (await createEntry(ctx.mgr, ctx.wsId, '../escape.txt', false))).toBe(true);
    expect('error' in (await deleteEntry(ctx.mgr, ctx.wsId, '../../etc'))).toBe(true);
    expect('error' in (await renameEntry(ctx.mgr, ctx.wsId, '../a', 'b'))).toBe(true);
    expect('error' in (await copyEntry(ctx.mgr, ctx.wsId, 'x', '../out'))).toBe(true);
  });
});
