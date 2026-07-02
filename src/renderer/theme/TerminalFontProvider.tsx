// 終端機字型 Provider（比照 ThemeProvider 模式）：初始讀 store.terminalFont、
// setFont 即時更新 context（開啟中的終端機由 TerminalView 訂閱後就地套用）並持久化。

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { TerminalFontSettings } from '../../shared/types';
import { DEFAULT_TERMINAL_FONT } from '../components/Terminal/secureOptions';

interface TerminalFontContextValue {
  font: TerminalFontSettings;
  setFont: (f: TerminalFontSettings) => void;
}

const TerminalFontContext = createContext<TerminalFontContextValue | null>(null);

export function TerminalFontProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [font, setFontState] = useState<TerminalFontSettings>(DEFAULT_TERMINAL_FONT);

  useEffect(() => {
    let cancelled = false;
    ipc.store
      .getState()
      .then((s) => {
        if (!cancelled && s.terminalFont) setFontState(s.terminalFont);
      })
      .catch(() => {
        /* 讀不到就用預設 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setFont = useCallback((f: TerminalFontSettings) => {
    setFontState(f);
    void ipc.store.setTerminalFont({ cfg: f });
  }, []);

  return <TerminalFontContext.Provider value={{ font, setFont }}>{children}</TerminalFontContext.Provider>;
}

export function useTerminalFont(): TerminalFontContextValue {
  const ctx = useContext(TerminalFontContext);
  if (!ctx) throw new Error('useTerminalFont 必須在 TerminalFontProvider 內使用');
  return ctx;
}
