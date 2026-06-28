// 子程序環境變數清洗（REQ-SEC-002 單一真相）。X-4 安全硬化。
//
// 兩種策略，對應兩類 spawn：
//  1) buildSpawnEnv —— app「主動呼叫的工具」（git / 語言伺服器 / LSP 安裝器）。白名單為主：
//     （註：ripgrep 的 SearchService.buildEnv 與程序探測的 processProbe.safeProbeEnv 刻意各自維持
//      「更窄」的最小白名單、不共用本函式——least-privilege；其安全性各自成立、見各自註解。）
//     只給已知安全的基礎環境（PATH/HOME/locale/SSH-agent…），其餘一律因不在白名單而排除。
//     這天然擋掉可達 RCE 的繼承變數：GIT_EXTERNAL_DIFF / GIT_SSH_COMMAND / GIT_PROXY_COMMAND /
//     GIT_ASKPASS / GIT_CONFIG_* / RIPGREP_CONFIG_PATH，以及 *_TOKEN/*_SECRET 機密與
//     NODE_OPTIONS / ELECTRON_RUN_AS_NODE 注入向量（都不在白名單）。
//  2) sanitizeUserEnv —— 使用者「自己的終端機 shell」（PTY）。shell 合理需要使用者完整環境，
//     故採 denylist 清洗：保留使用者環境，只剔除 Electron/Node 程序注入向量
//     （ELECTRON_RUN_AS_NODE / NODE_OPTIONS——會讓子 node 程序載入注入碼）。
//     不動使用者自己的 GIT_*/個人 token（那是他的 shell、他的環境）。
//
// 兩函式皆可注入 source（預設 process.env）以利單元測試；extra 最後覆蓋（呼叫端疊加工具必要變數）。

/** 主動 spawn 工具的安全白名單（Windows env 名稱不分大小寫，比對時一律 lower）。 */
const ALLOW_KEYS = [
  'PATH', 'PATHEXT', 'SystemRoot', 'windir', 'COMSPEC',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)',
  'TEMP', 'TMP', 'TMPDIR', 'NUMBER_OF_PROCESSORS',
  'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TZ', 'TERM',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'DISPLAY',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
];

/**
 * 白名單最小環境：從 source 只挑安全基礎變數，再疊上 extra（工具必要的額外變數，如 GOTOOLCHAIN）。
 * 危險的繼承 GIT_* 變數、機密、注入向量因不在白名單而被排除。
 */
export function buildSpawnEnv(
  extra: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allow = new Set(ALLOW_KEYS.map((k) => k.toLowerCase()));
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && allow.has(k.toLowerCase())) out[k] = v;
  }
  return { ...out, ...extra };
}

/** PTY denylist：剔除會被 shell 自動執行碼濫用的 Electron/Node 注入向量。
 *  以小寫存放並比對：Windows env 名稱不分大小寫，避免 node_options/Electron_Run_As_Node 之類大小寫繞過。 */
const USER_ENV_DENY = new Set(['electron_run_as_node', 'node_options']);

/**
 * 使用者 shell 環境清洗（PTY）：保留使用者完整環境，只移除 Electron/Node 程序注入向量。
 * 註：本 app 不在 main 程序環境注入任何自有機密（無更新/簽章 token 進 env），故除上述注入向量外
 * 無 app 機密需額外剔除；使用者自己的 token/GIT_* 屬其終端機環境，刻意保留以免破壞開發工作流。
 */
export function sanitizeUserEnv(
  extra: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || USER_ENV_DENY.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}
