// 語言伺服器登錄表（F-5：REQ-EDIT-003/004/005）。副檔名 → 語言伺服器描述（langId/serverId/
// 執行檔/旗標/可否自動安裝/安裝提示）。純資料 + 查詢函式，無 node 相依，可單元測試。
//
// 安全註記（紅軍 F-5-A2）：cmd 一律「裸執行檔名」，實際 spawn 前由 serverProbe 解析成「PATH 內、
// 不在工作區/cwd 的絕對路徑」；本表絕不放可由工作區覆寫的相對路徑。

/** 自動安裝指令（execFile，shell:false，固定 args，無使用者輸入）。 */
export interface InstallCmd {
  file: string;
  args: string[];
}

export interface LanguageServerDesc {
  /** monaco language id（與 renderer provider 註冊鍵一致）。 */
  langId: string;
  /** 伺服器識別（同一 serverId 在同工作區只起一個實例，如 clangd 同時服務 c/cpp）。 */
  serverId: string;
  /** 裸執行檔名（解析成絕對路徑後才 spawn）。 */
  cmd: string;
  /** 啟動旗標（stdio 模式等）。 */
  args: string[];
  /** 是否提供一鍵安裝（有 installCmd 才為 true）。 */
  installable: boolean;
  /** 缺件時給使用者看的手動安裝指令字串。 */
  installHint: string;
  /** installable 時的實際安裝指令。 */
  installCmd?: InstallCmd;
}

/** langId → 伺服器描述（單一真相）。 */
const BY_LANG_ID: Readonly<Record<string, LanguageServerDesc>> = {
  python: {
    langId: 'python',
    serverId: 'pyright',
    cmd: 'pyright-langserver',
    args: ['--stdio'],
    installable: true,
    installHint: 'npm i -g pyright（或 pip install pyright）',
    installCmd: { file: 'npm', args: ['i', '-g', 'pyright'] },
  },
  go: {
    langId: 'go',
    serverId: 'gopls',
    cmd: 'gopls',
    args: [],
    installable: true,
    installHint: 'go install golang.org/x/tools/gopls@latest',
    installCmd: { file: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'] },
  },
  rust: {
    langId: 'rust',
    serverId: 'rust-analyzer',
    cmd: 'rust-analyzer',
    args: [],
    installable: true,
    installHint: 'rustup component add rust-analyzer',
    installCmd: { file: 'rustup', args: ['component', 'add', 'rust-analyzer'] },
  },
  c: {
    langId: 'c',
    serverId: 'clangd',
    cmd: 'clangd',
    args: [],
    installable: false,
    installHint: '安裝 LLVM / clangd 並加入 PATH（https://clangd.llvm.org/installation）',
  },
  cpp: {
    langId: 'cpp',
    serverId: 'clangd',
    cmd: 'clangd',
    args: [],
    installable: false,
    installHint: '安裝 LLVM / clangd 並加入 PATH（https://clangd.llvm.org/installation）',
  },
  java: {
    langId: 'java',
    serverId: 'jdtls',
    cmd: 'jdtls',
    args: [],
    installable: false,
    installHint: '安裝 Eclipse JDT Language Server（jdtls）並加入 PATH',
  },
  csharp: {
    langId: 'csharp',
    serverId: 'csharp-ls',
    cmd: 'csharp-ls',
    args: [],
    installable: true,
    installHint: 'dotnet tool install -g csharp-ls',
    installCmd: { file: 'dotnet', args: ['tool', 'install', '-g', 'csharp-ls'] },
  },
};

/** 副檔名（不含點，小寫）→ langId。 */
const EXT_TO_LANG: Readonly<Record<string, string>> = {
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  hh: 'cpp',
  java: 'java',
  cs: 'csharp',
};

/** 本橋接支援的 langId 清單（renderer 也據此註冊 provider；此處為單一真相鏡像）。 */
export const SUPPORTED_LANG_IDS: readonly string[] = Object.keys(BY_LANG_ID);

/** 由 langId 查描述（未支援回 undefined）。 */
export function byLangId(langId: string): LanguageServerDesc | undefined {
  return BY_LANG_ID[langId];
}

/** 由副檔名查描述（可含或不含前導點，大小寫不敏感）。 */
export function byExt(ext: string): LanguageServerDesc | undefined {
  if (typeof ext !== 'string') return undefined;
  const norm = ext.replace(/^\.+/, '').toLowerCase();
  const langId = EXT_TO_LANG[norm];
  return langId ? BY_LANG_ID[langId] : undefined;
}

/** 由檔名/路徑取副檔名後查描述。 */
export function byPath(p: string): LanguageServerDesc | undefined {
  const m = /\.([^.\\/]+)$/.exec(p);
  return m ? byExt(m[1]) : undefined;
}
