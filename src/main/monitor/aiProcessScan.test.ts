// aiProcessScan 解析純函式測試：wmic/powershell 輸出 → parent pid 集合（跳 header/空行/非數字）。
import { describe, it, expect } from 'vitest';
import { parsePids, parseTaggedPids, resolveWindowsProcessTools, scanAiShellPids } from './aiProcessScan';

describe('aiProcessScan.parsePids', () => {
  it('解析 wmic 輸出：跳 header 與空行、取數字 ppid', () => {
    const out = parsePids('ParentProcessId\r\n27188\r\n4876\r\n\r\n');
    expect(out.has(27188)).toBe(true);
    expect(out.has(4876)).toBe(true);
    expect(out.size).toBe(2);
  });

  it('空輸出 / 純非數字 → 空集合', () => {
    expect(parsePids('').size).toBe(0);
    expect(parsePids('ParentProcessId\r\n\r\n').size).toBe(0);
    expect(parsePids('No Instance(s) Available.').size).toBe(0);
  });

  it('去重相同 ppid（多個 claude 在同一 shell）', () => {
    const out = parsePids('5828\n5828\n999\n');
    expect(out.size).toBe(2);
    expect(out.has(5828)).toBe(true);
    expect(out.has(999)).toBe(true);
  });

  it('解析合併標記輸出：Claude / Codex / Agy 各自歸戶並忽略壞值', () => {
    const out = parseTaggedPids('C:100\r\nX:200\r\nA:300\r\nA:300\r\nA:nope\r\n');
    expect([...out.claude]).toEqual([100]);
    expect([...out.codex]).toEqual([200]);
    expect([...out.agy]).toEqual([300]);
  });

  it('PATH 缺少系統目錄時，WMIC 與 PowerShell 掃描仍使用 SystemRoot 絕對路徑', async () => {
    const env = { PATH: 'C:\\Tools', systemroot: 'D:\\Windows' };
    const tools = resolveWindowsProcessTools(env);
    expect(tools).toEqual({
      wmic: 'D:\\Windows\\System32\\wbem\\WMIC.exe',
      powershell: 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    });

    const calls: string[] = [];
    const result = await scanAiShellPids({
      platform: 'win32',
      env,
      execProcess: (file, _args, _options, callback) => {
        calls.push(file);
        if (file === tools.wmic) callback(new Error('wmic unavailable'), '');
        else callback(null, 'C:100\r\nX:200\r\nA:300\r\n');
      },
    });

    expect(calls).toEqual([tools.wmic, tools.wmic, tools.wmic, tools.powershell]);
    expect([...result.claude ?? []]).toEqual([100]);
    expect([...result.codex ?? []]).toEqual([200]);
    expect([...result.agy ?? []]).toEqual([300]);
  });
});
