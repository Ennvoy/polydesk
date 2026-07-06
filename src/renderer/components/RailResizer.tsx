// 工作區 rail 與主區域之間的可拖曳分隔條（問題 A：rail 本來寬度固定、無法調整）。
// 拖曳改 :root 的 --rail-w（WorkspaceRail 寬度即時跟隨），放開時經 store IPC 落檔持久化
// （沿用 windowBounds 範式，重啟還原）。鍵盤 ArrowLeft/Right ±16px 可調（a11y）。
// 拖曳期間鋪全螢幕 overlay 吃住所有 pointer 事件，避免游標移到 xterm/monaco canvas 上漏接 pointermove。

import React, { useEffect, useRef, useState } from 'react';
import { ipc } from '../ipc/client';

const RAIL_MIN = 180; // 再窄會擠壞 EmptyWelcome（段落 maxWidth ~200）
const RAIL_MAX = 480; // 再寬在小視窗會吃掉主編輯區
const RAIL_VAR = '--rail-w';
const KEY_STEP = 16;
const DEFAULT_W = 240; // 對齊 tokens.css 預設

const STYLE_ID = 'pd-rail-resizer-style';
function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent =
    '.pd-rail-resizer:hover,.pd-rail-resizer.is-dragging,.pd-rail-resizer:focus-visible{background:var(--accent,#6e8efb)!important;}' +
    '.pd-rail-resizer:focus-visible{outline:none;}';
  document.head.appendChild(el);
}

function clampWidth(px: number): number {
  return Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(px)));
}

function currentRailWidth(): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(RAIL_VAR).trim();
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : DEFAULT_W;
  } catch {
    return DEFAULT_W;
  }
}

function applyRailWidth(px: number): void {
  document.documentElement.style.setProperty(RAIL_VAR, `${px}px`);
}

export function RailResizer(): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const selfRef = useRef<HTMLDivElement | null>(null);
  // aria-valuenow 單一真相：追蹤目前 rail 寬度，讓 splitter 的無障礙數值隨拖曳/鍵盤即時反映
  // （role=separator + 可聚焦＝window splitter，ARIA 要求須有 aria-valuenow）。
  const [width, setWidth] = useState<number>(DEFAULT_W);

  // 同步設寬度：套 CSS var（畫面即時）+ 更新 state（aria-valuenow 跟上）。
  const setRailWidth = (px: number): void => {
    const w = clampWidth(px);
    applyRailWidth(w);
    setWidth(w);
  };

  // 掛載時還原持久化寬度（若有），並監看 --rail-w 的外部變動同步 aria-valuenow。
  useEffect(() => {
    ensureStyle();
    let cancelled = false;
    void ipc.store
      .getState()
      .then((s) => {
        if (cancelled) return;
        if (typeof s.railWidth === 'number') setRailWidth(s.railWidth);
      })
      .catch(() => undefined);
    // 外部改 --rail-w（如「重設版面」直接把 :root 設回 240、不經本元件 setRailWidth）→ aria-valuenow 會失準。
    // 監看 documentElement 的 style 變動、把 state 同步回目前 CSS var（相同值回傳 prev 不觸發重繪；拖曳中亦為 no-op）。
    const obs = new MutationObserver(() => {
      const w = currentRailWidth();
      setWidth((prev) => (prev === w ? prev : w));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      cancelled = true;
      obs.disconnect();
      overlayRef.current?.remove();
      overlayRef.current = null;
    };
  }, []);

  const persist = (): void => {
    void ipc.store.setRailWidth({ width: currentRailWidth() }).catch(() => undefined);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    selfRef.current?.classList.add('is-dragging');
    // 全螢幕 overlay：拖曳期間吃住所有 pointer 事件（游標移到 xterm/monaco 也不漏接）+ 統一 cursor。
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);
    overlayRef.current = overlay;
    const startX = e.clientX;
    const startW = currentRailWidth();

    const onMove = (ev: PointerEvent): void => {
      setRailWidth(startW + (ev.clientX - startX));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      overlayRef.current?.remove();
      overlayRef.current = null;
      selfRef.current?.classList.remove('is-dragging');
      persist();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // OS 中斷 / 視窗失焦 / 拖出視窗外放開（pointerup 落空）→ pointercancel 也清掉 overlay，
    // 避免那塊 z-index:9999 全螢幕 overlay 殘留蓋住整個畫面、害 dockview 與所有東西都點不到/拖不動。
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -KEY_STEP;
    else if (e.key === 'ArrowRight') delta = KEY_STEP;
    else return;
    e.preventDefault();
    setRailWidth(currentRailWidth() + delta);
    persist();
  };

  return (
    <div
      ref={selfRef}
      className="pd-rail-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="調整工作區欄寬度"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={{
        flexShrink: 0,
        width: 5,
        alignSelf: 'stretch',
        cursor: 'col-resize',
        background: 'transparent',
        transition: 'background var(--motion-fast) var(--ease-standard)',
      }}
    />
  );
}
