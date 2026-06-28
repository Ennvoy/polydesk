// monaco diff editor 封裝（REQ-SCM-003）。import '../../monacoSetup' 已於 feature 入口設定 worker。
// 由 git:diff 的 patch 重建 original/modified model 顯示；唯讀、automaticLayout 自適應面板寬高。

import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { parseUnifiedDiff, langFromPath } from './diffParse';

function currentMonacoTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
}

export function DiffView({ path, patch }: { path: string; patch: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  // 建立 / 銷毀 diff editor（一次）。
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    const editor = monaco.editor.createDiffEditor(el, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: false, // 窄面板用 inline，仍是 createDiffEditor 雙 model
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: mono || undefined,
      fontSize: 12,
      theme: currentMonacoTheme(),
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // 內容變更 → 重建 model（並隨主題刷新）。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    monaco.editor.setTheme(currentMonacoTheme());
    const { original, modified } = parseUnifiedDiff(patch);
    const lang = langFromPath(path);
    const o = monaco.editor.createModel(original, lang);
    const m = monaco.editor.createModel(modified, lang);
    editor.setModel({ original: o, modified: m });
    return () => {
      o.dispose();
      m.dispose();
    };
  }, [path, patch]);

  const empty = patch.trim().length === 0;
  return (
    <div className="pd-scm-diffwrap">
      {empty && (
        <p className="pd-scm-diff-empty" role="note">
          無文字差異可顯示（新檔／二進位／無變更）。
        </p>
      )}
      <div ref={hostRef} className="pd-scm-diff" aria-label={`差異檢視：${path}`} />
    </div>
  );
}
