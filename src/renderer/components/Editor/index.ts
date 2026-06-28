// Editor feature 進入點（F-4）：設定 Monaco worker 環境、載入樣式、自註冊 'editor' 槽。
// features.ts 以 side-effect import 本檔（import './components/Editor'）即完成登錄。

import '../../monacoSetup'; // 務必：設定 self.MonacoEnvironment.getWorker，避免 fallback 主執行緒
import './editor.css';
import { registerPanel, SLOT } from '../../layout/panelRegistry';
import { EditorGroup } from './EditorGroup';

registerPanel(SLOT.editor, EditorGroup);
