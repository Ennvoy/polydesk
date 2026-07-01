// aiProcessScan 解析純函式測試：wmic/powershell 輸出 → parent pid 集合（跳 header/空行/非數字）。
import { describe, it, expect } from 'vitest';
import { parsePids } from './aiProcessScan';

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
});
