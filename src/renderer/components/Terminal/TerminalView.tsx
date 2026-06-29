// 單一 xterm 實例（綁定一個 termId）。負責：掛載 xterm + fit(+可選 WebGL)、雙向接線
// （term.onData→ipc.pty.write；ipc.pty.onData→term.write）、ResizeObserver→fit+resize、
// 近似量測按鍵延遲（REQ-PERF-004）。結束狀態（exit code + 重啟）由父層以 prop 控制（REQ-TERM-006）。
//
// 安全：以 createSecureTerminalOptions 初始化（關閉視窗/標題回報＝防回灌注入；不掛 clipboard
// addon＝不寫剪貼簿，REQ-TERM-008）。

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { ipc } from '../../ipc/client';
import { record } from '../../../shared/perf';
import { createSecureTerminalOptions, DEFAULT_TERMINAL_THEME } from './secureOptions';
import type { ITheme } from '@xterm/xterm';

interface Props {
  termId: string;
  visible: boolean;
  /** 非 null 表示該程序已結束（顯示 exit overlay + 重啟）。 */
  exitCode: number | null;
  onRestart: () => void;
}

/** 從 CSS var 讀目前主題色，建構 xterm ITheme（取不到則用暗色缺省）。 */
function readTerminalTheme(el: HTMLElement): ITheme {
  try {
    const cs = getComputedStyle(el);
    const v = (name: string): string => cs.getPropertyValue(name).trim();
    const bg = v('--bg') || DEFAULT_TERMINAL_THEME.background;
    const fg = v('--fg') || DEFAULT_TERMINAL_THEME.foreground;
    return {
      background: bg,
      foreground: fg,
      cursor: fg,
      selectionBackground: 'rgba(127,127,127,0.35)',
    };
  } catch {
    return DEFAULT_TERMINAL_THEME;
  }
}

/**
 * 跨「面板隱藏（removePanel→dispose）→重開（reattach）」保留終端機畫面（scrollback）：模組級快取，鍵=termId。
 * 隱藏前序列化 xterm 內容存入；重開掛載時寫回還原（PTY 本就存活、再加還原畫面＝完整「原地隱藏」）。
 */
const scrollbackCache = new Map<string, string>();

/** 終端機真正關閉/重啟時清掉其畫面快取（避免殘留 / termId 重用誤還原）。 */
export function forgetTerminalScrollback(termId: string): void {
  scrollbackCache.delete(termId);
}

export function TerminalView({ termId, visible, exitCode, onRestart }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 近似按鍵延遲：使用者輸入時記時間戳，下一個回流的 chunk 視為回顯。
  const keyTsRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal(createSecureTerminalOptions(readTerminalTheme(host)));
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serialize);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // 重開（reattach）時還原隱藏前的畫面（scrollback）；新建（無快取）則略過。寫在 PTY 新資料訂閱前。
    const cached = scrollbackCache.get(termId);
    if (cached) term.write(cached);

    // WebGL 加速（可選；不支援則靜默略過，回退 canvas/DOM renderer）。
    let disposed = false;
    let webglDispose: (() => void) | null = null;
    void (async () => {
      try {
        const mod = await import('@xterm/addon-webgl');
        if (disposed) return; // 元件已卸載：勿對已 dispose 的 term loadAddon
        const addon = new mod.WebglAddon();
        addon.onContextLoss(() => addon.dispose());
        term.loadAddon(addon);
        webglDispose = () => addon.dispose();
      } catch {
        /* WebGL 不可用：略過 */
      }
    })();

    const safeFit = (): void => {
      if (!hostRef.current || hostRef.current.offsetWidth === 0 || hostRef.current.offsetHeight === 0) return;
      try {
        fit.fit();
        void ipc.pty.resize({ termId, cols: term.cols, rows: term.rows });
      } catch {
        /* 尺寸尚未就緒：略過本次 */
      }
    };

    // 輸入：term → main（高頻；標記時間戳供延遲量測）。
    const onDataDisp = term.onData((d) => {
      keyTsRef.current = performance.now();
      ipc.pty.write(termId, d);
    });

    // 輸出：main → term（依 termId 過濾；回流即記一次往返延遲近似值）。
    const offData = ipc.pty.onData(({ termId: t, chunk }) => {
      if (t !== termId) return;
      term.write(chunk);
      if (keyTsRef.current !== null) {
        record('keyLatency', performance.now() - keyTsRef.current);
        keyTsRef.current = null;
      }
    });

    const ro = new ResizeObserver(() => safeFit());
    ro.observe(host);
    // 初次 fit（下一幀，確保 DOM 已量得尺寸）。
    const raf = requestAnimationFrame(safeFit);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      onDataDisp.dispose();
      offData();
      // dispose 前序列化畫面存入快取（隱藏/重排造成的卸載 → 重開可還原）。
      try {
        scrollbackCache.set(termId, serialize.serialize());
      } catch {
        /* 序列化失敗：略過（重開為空畫面，不致命） */
      }
      webglDispose?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [termId]);

  // 由隱藏切回顯示時重新 fit + 聚焦（display:none 時容器尺寸為 0，無法 fit）。
  useLayoutEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !hostRef.current) return;
    if (hostRef.current.offsetWidth === 0 || hostRef.current.offsetHeight === 0) return;
    try {
      fit.fit();
      void ipc.pty.resize({ termId, cols: term.cols, rows: term.rows });
      term.focus();
    } catch {
      /* 略過 */
    }
  }, [visible, termId]);

  return (
    <div
      className="pd-term-view"
      style={{ position: 'absolute', inset: 0, display: visible ? 'block' : 'none' }}
      role="group"
      aria-label="終端機輸出"
      aria-hidden={!visible}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, padding: 'var(--space-2)' }} />
      {exitCode !== null && (
        <div
          className="pd-term-exit"
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in oklab, var(--bg), transparent 12%)',
            color: 'var(--fg-2)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span>處理程序已結束（exit code {exitCode}）</span>
          <button className="pd-btn pd-btn-primary" onClick={onRestart} aria-label="重新啟動終端機">
            重新啟動
          </button>
        </div>
      )}
    </div>
  );
}
