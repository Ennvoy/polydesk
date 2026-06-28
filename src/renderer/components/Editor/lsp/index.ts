// LSP 橋接 feature 進入點（F-5）：features.ts 以 side-effect import 本檔（import './components/Editor/lsp'）
// 即註冊全域 monaco provider + diagnostics 訂閱 + 文件同步 + 缺件 probe/toast。
// 註：F-4 的 EditorGroup 不需改——provider 是 per-language 全域註冊。

import '../../../monacoSetup'; // 確保 monaco worker 環境（獨立 import monaco 時的自保護；F-4 已設過則冪等）
import { installLspBridge } from './lspClient';

installLspBridge();
