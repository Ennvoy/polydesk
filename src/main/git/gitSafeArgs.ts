// git 引數安全建構（F-7 紅軍 A1/A2/A4 防線）。
// 設計原則：
// - validateRef 走「白名單等價於 git check-ref-format --branch」：拒所有 refspec/路徑語意字元，
//   非黑名單（黑名單會放行 `main:refs/heads/x`、`+main`、`@{0}` 等 → force-push/任意 ref 覆寫）。
// - 一律以「陣列 argv」呼叫 git（shell:false），使用者路徑前置 '--'（選項終止符）並包成
//   literal pathspec（`:(literal)<path>`），令 pathspec magic（:(exclude)/:/）不生效。
// - read 類操作統一硬化（每次都帶）：禁 fsmonitor/hooks/pager/textconv（repo .git/config 可為 RCE 載體）。

// GIT_CONFIG_GLOBAL 的「空設定」值：一律用 POSIX '/dev/null'，Git for Windows（MSYS）也認得；
// 不可用 node:os 的 devNull（Windows 為 '\\.\nul'，git 視為設定檔路徑會 fatal「unable to access」）。
const NULL_CONFIG = '/dev/null';

// 雙向覆寫 / 零寬 / 隱形格式控制字元（可視覺欺騙 ref 名）。以 \u escape 表述，避免原始字元混進檔案。
const BIDI_FORMAT = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
// git refspec / pathspec / glob 語意字元（一律拒）：空白 tab ~ ^ : ? * [ ] \ +。
const FORBIDDEN_CHARS = /[ \t~^:?*[\]\\+]/;

/**
 * 分支 / remote ref 名格式驗證（白名單）。等價 `git check-ref-format --branch` 規則 + 額外硬化：
 * 拒 refspec force 標記（前導 `+`）、`:`（src:dst）、`@{}`、`~ ^ ? * [ \`、空白/控制字元、
 * 雙向覆寫字元、前導 `-`、前導/結尾/連續 `/`、前導/結尾 `.`、`..`、`.lock` 結尾、`HEAD`、超長。
 * 通過者才可進 argv；不通過＝呼叫端應「永不執行 git」並回明確 invalid 錯誤。
 */
export function validateRef(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 255) return false;
  if (name === 'HEAD' || name === '@') return false;

  // 控制字元（含 DEL）
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if (c === undefined || c < 0x20 || c === 0x7f) return false;
  }
  if (BIDI_FORMAT.test(name)) return false;
  if (FORBIDDEN_CHARS.test(name)) return false;

  if (name.startsWith('-')) return false; // 防被當選項
  if (name.startsWith('/') || name.endsWith('/')) return false;
  if (name.startsWith('.') || name.endsWith('.')) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.includes('@{')) return false;

  // 逐段檢查：不可空段、不可段首 '.'、不可 '.lock' 結尾
  for (const part of name.split('/')) {
    if (part.length === 0) return false;
    if (part.startsWith('.')) return false;
    if (part.endsWith('.lock')) return false;
  }
  return true;
}

/**
 * read 類硬化旗標（global -c，須置於 subcommand 前）：
 * fsmonitor/hooks/pager 全關 + quotePath=false，避免惡意 .git/config 自動執行命令（A2 零點擊 RCE）、
 * 並讓含特殊字元檔名以原樣輸出（配 -z 解析，A4）。
 */
export function readHardeningArgs(): string[] {
  return [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=',
    '-c', 'core.pager=',
    '-c', 'core.quotePath=false',
    '--no-pager',
  ];
}

/**
 * read 類環境硬化：禁 system/global config（移除 RCE/設定注入面）、關 optional locks（讀不撞 index.lock）、
 * 關終端機提示（讀不該卡認證）。
 */
export function readEnv(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: NULL_CONFIG,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * write 類環境：仍禁 system config，但保留 global config（commit 需 user.name/email、push 需 credential helper）。
 * 關終端機提示，逾時保護下不卡互動式認證（push/pull 失敗 → 明確 error，不假裝成功）。
 */
export function writeEnv(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** 使用者路徑一律當 literal pathspec（A4：令 :(exclude)/:/:! magic 不生效）。 */
export function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

/** 在 base argv 後接「-- + literal pathspec」，把使用者輸入鎖在路徑語意。 */
export function withPathspecs(base: string[], paths: string[]): string[] {
  return [...base, '--', ...paths.map(literalPathspec)];
}
