const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_EXTERNAL_URL_LENGTH = 8_192;

/**
 * 驗證並正規化交給系統瀏覽器的網址。
 *
 * 只允許無帳密的 HTTP(S) URL；控制字元、其他協定與過長輸入一律拒絕。renderer 與 main
 * 共用同一條規則，避免終端輸出可繞過前端檢查觸發 javascript:、file: 或含憑證的 URL。
 */
export function normalizeExternalHttpUrl(raw: string): string | null {
  if (!raw || raw.length > MAX_EXTERNAL_URL_LENGTH || CONTROL_CHARS.test(raw)) return null;
  // WHATWG URL 會把 http:///missing-host 寬鬆修正成 http://missing-host/；外開入口不接受這類非標準輸入。
  if (!/^https?:\/\/[^/]/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isSafeExternalHttpUrl(raw: string): boolean {
  return normalizeExternalHttpUrl(raw) !== null;
}
