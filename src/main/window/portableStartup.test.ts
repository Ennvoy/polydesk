import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';

const { appMock, writeMock } = vi.hoisted(() => ({
  appMock: { isPackaged: true },
  writeMock: vi.fn(),
}));

vi.mock('electron', () => ({ app: appMock }));
vi.mock('node:fs', () => ({ writeFileSync: writeMock }));

import { markPortableStartupReady } from './portableStartup';

describe('portable 就緒標記', () => {
  const previous = process.env['PORTABLE_EXECUTABLE_FILE'];

  beforeEach(() => {
    appMock.isPackaged = true;
    process.env['PORTABLE_EXECUTABLE_FILE'] = 'Z:\\任意外部目錄\\Polydesk.exe';
    writeMock.mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env['PORTABLE_EXECUTABLE_FILE'];
    else process.env['PORTABLE_EXECUTABLE_FILE'] = previous;
    vi.restoreAllMocks();
  });

  it('只在本次執行檔旁寫固定檔名，不使用環境變數作路徑', () => {
    markPortableStartupReady();
    expect(writeMock).toHaveBeenCalledWith(
      join(dirname(process.execPath), '.polydesk-startup-ready'), '', { flag: 'wx' },
    );
  });

  it('非 portable 不建立標記；寫入失敗也不打斷啟動', () => {
    appMock.isPackaged = false;
    markPortableStartupReady();
    expect(writeMock).not.toHaveBeenCalled();

    appMock.isPackaged = true;
    delete process.env['PORTABLE_EXECUTABLE_FILE'];
    markPortableStartupReady();
    expect(writeMock).not.toHaveBeenCalled();

    process.env['PORTABLE_EXECUTABLE_FILE'] = 'Polydesk.exe';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeMock.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    expect(() => markPortableStartupReady()).not.toThrow();
    expect(errorLog).toHaveBeenCalledOnce();
  });
});
