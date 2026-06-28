// 三主題 Provider（REQ-THEME-001/002）：初始讀 store.theme、套 [data-theme]、即時切換並持久化。

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { ThemeId } from '../../shared/types';
import './tokens.css';
import './components.css';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(t: ThemeId): void {
  document.documentElement.setAttribute('data-theme', t);
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemeId>('dark');

  useEffect(() => {
    let cancelled = false;
    ipc.store
      .getState()
      .then((s) => {
        if (cancelled) return;
        setThemeState(s.theme);
        applyTheme(s.theme);
      })
      .catch(() => applyTheme('dark'));
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    applyTheme(t);
    void ipc.store.setTheme({ theme: t });
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必須在 ThemeProvider 內使用');
  return ctx;
}
