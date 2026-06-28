// F-7 SourceControl feature 入口（side-effect 自註冊）。
// features.ts 以 `import './components/SourceControl'` 匯入即生效；不碰 panelRegistry/App。

import '../../monacoSetup'; // diff 用 monaco worker（與 Editor F-4 共用同一份設定）
import './scm.css';
import { registerPanel, SLOT } from '../../layout/panelRegistry';
import { SourceControlPanel } from './SourceControlPanel';

registerPanel(SLOT.viewScm, SourceControlPanel);
