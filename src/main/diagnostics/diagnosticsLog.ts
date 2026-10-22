// 主程序診斷 log：每行一筆 JSON，同步 append，單檔超過上限時輪替成 main.1.log（只留一代）。
// 任何檔案系統失敗一律吞掉，診斷不得影響主流程。

import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_FILE = 'main.log';
const LOG_ROTATED_FILE = 'main.1.log';

/** 格式化單筆記錄；保留欄位 at／kind 不被 data 覆寫，無法序列化時退回錯誤標記。 */
export function formatLine(kind: string, data?: Record<string, unknown>, now: Date = new Date()): string {
  try {
    return JSON.stringify({ ...data, at: now.toISOString(), kind }) + '\n';
  } catch {
    return JSON.stringify({ at: now.toISOString(), kind, error: 'unserializable-data' }) + '\n';
  }
}

export function shouldRotate(currentSize: number, incomingBytes: number, maxBytes: number = LOG_MAX_BYTES): boolean {
  return currentSize > 0 && currentSize + incomingBytes > maxBytes;
}

const TEXT_MAX_CHARS = 4096;

/** 寫入 log 的字串：遮罩 URL 內嵌的帳密（//user:pass@ → //***@），再截到上限。 */
export function sanitizeText(text: string): string {
  return text.replace(/\/\/[^@/\s]+@/g, '//***@').slice(0, TEXT_MAX_CHARS);
}

export function errorText(reason: unknown): string {
  return sanitizeText(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
}

/** 對指定目錄寫入一筆記錄（可測試的核心）。失敗不丟例外。 */
export function appendLog(dir: string, kind: string, data?: Record<string, unknown>, maxBytes: number = LOG_MAX_BYTES): void {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, LOG_FILE);
    const line = formatLine(kind, data);
    let size = 0;
    try { size = statSync(file).size; } catch { /* 檔案尚不存在 */ }
    if (shouldRotate(size, Buffer.byteLength(line), maxBytes)) {
      try { renameSync(file, join(dir, LOG_ROTATED_FILE)); } catch { /* 輪替失敗仍照常 append */ }
    }
    appendFileSync(file, line, 'utf-8');
  } catch {
    // 診斷寫入失敗不影響主流程
  }
}

/** 說明選單開啟的資料夾：userData 根目錄，同時看得到 logs/ 與 Crashpad/。 */
export function diagnosticsRoot(): string {
  return app.getPath('userData');
}

export function diagnosticsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

export function logDiagnostic(kind: string, data?: Record<string, unknown>): void {
  try {
    appendLog(diagnosticsDir(), kind, data);
  } catch {
    // app.getPath 失敗亦吞掉
  }
}
