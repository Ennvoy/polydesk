// Clone 表單與 main 共用的純字串規則；不依賴 Node API，renderer 可安全引用。

const FORMAT_CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * 第一版只接受明確的網路 repository 格式，避免 Git 自訂 remote helper（例如 ext::）
 * 或把使用者輸入誤當成本機路徑。HTTPS 禁止 URL userinfo，避免 token 出現在程序參數。
 */
export function cloneUrlError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '請輸入 Repository URL。';
  if (value.length > 2048 || FORMAT_CONTROL.test(value)) return 'Repository URL 格式不合法。';
  if (value.startsWith('-')) return 'Repository URL 不可用選項字元開頭。';

  // 常見 SSH scp-like：git@github.com:owner/repo.git
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(value)) return null;

  try {
    const u = new URL(value);
    if (!['https:', 'ssh:'].includes(u.protocol)) {
      return '目前僅支援 HTTPS 與 SSH Repository URL。';
    }
    if (!u.hostname || !u.pathname || u.pathname === '/') return 'Repository URL 缺少主機或 Repository 路徑。';
    if (u.protocol === 'https:' && (u.username || u.password)) {
      return '請勿把帳號、密碼或 Token 寫在 URL；請改用 Git Credential Manager。';
    }
    if (u.password) return '請勿把密碼或 Token 寫在 Repository URL。';
    return null;
  } catch {
    return 'Repository URL 格式不合法。';
  }
}

/** 從 URL 推導預設資料夾名；無法推導時回空字串，交由使用者填寫。 */
export function cloneDirectoryNameFromUrl(raw: string): string {
  const value = raw.trim().replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
  if (!value) return '';
  const colon = value.match(/^[^@\s]+@[^:\s]+:(.+)$/)?.[1];
  const path = colon ?? value;
  const last = path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  try {
    return decodeURIComponent(last).replace(/\.git$/i, '');
  } catch {
    return last.replace(/\.git$/i, '');
  }
}

/** 嚴格限制為單層、跨平台可用的資料夾名，避免跳脫選定父資料夾。 */
export function cloneDirectoryNameError(raw: string): string | null {
  if (!raw) return '請輸入資料夾名稱。';
  if (raw !== raw.trim()) return '資料夾名稱前後不可有空白。';
  if (raw.length > 120 || FORMAT_CONTROL.test(raw)) return '資料夾名稱過長或含有不可見控制字元。';
  if (raw === '.' || raw === '..' || WINDOWS_FORBIDDEN.test(raw)) return '資料夾名稱含有不允許的字元。';
  if (raw.endsWith('.') || raw.endsWith(' ') || WINDOWS_RESERVED.test(raw)) return '這個資料夾名稱在 Windows 無法使用。';
  return null;
}
