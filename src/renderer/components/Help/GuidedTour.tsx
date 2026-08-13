import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ONBOARDING_VERSION } from '../../../shared/constants';
import { ipc } from '../../ipc/client';
import { railBus } from '../../state/railBus';
import { tourBus, useTourRequest, type TourMode } from '../../state/tourBus';
import { revealLayoutPanelForTour, type LayoutPanelName } from '../../layout/DockLayout';
import './tour.css';

interface TourStep {
  title: string;
  body: string;
  target: string;
  reveal?: 'rail' | LayoutPanelName;
}

const STEPS: TourStep[] = [
  { title: '歡迎來到 Polydesk', body: '這裡集中管理所有專案。用＋加入資料夾、Clone repository，或從分支建立獨立 worktree。', target: '[data-tour="workspace-rail"]', reveal: 'rail' },
  { title: '常用功能就在側欄上方', body: '依序切換檔案總管、全域搜尋與原始碼控制；齒輪開啟設定。按鈕會貼近它所切換的側欄內容。', target: '[data-tour="workspace-tools"]', reveal: 'sidebar' },
  { title: '快速控制工作台版面', body: '工作區、側欄、編輯器與終端機都能原地顯示或隱藏；重設版面會盡量保留開啟中的工作。', target: '[data-tour="layout-toolbar"]' },
  { title: '側欄跟著目前功能切換', body: '檔案、搜尋與 Git 共享同一個側欄位置。選擇側欄頂部圖示，下面的內容會立即切換。', target: '.pd-sidebar-view', reveal: 'sidebar' },
  { title: '編輯器與終端機可以自由停靠', body: '開啟檔案、檢查差異、執行 shell 或 AI CLI。按分頁×只會原地隱藏，重新顯示時保留尺寸與狀態。', target: '[data-tour="dock-workbench"]', reveal: 'editor' },
  { title: '終端機也能啟動 AI 工具', body: 'Claude bypass、Codex 與 Agy 會各自建立獨立終端機；bypass 只適用於完全信任的工作區。', target: '[data-tour="dock-workbench"]', reveal: 'terminal' },
  { title: '隨時回來查說明', body: '從「說明」重新執行導覽、搜尋完整使用指南，或查看 Polydesk 版本資訊。', target: '[data-tour="help-menu"]' },
];

interface HighlightRect { left: number; top: number; width: number; height: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function GuidedTour({ id, mode, initialStep }: { id: number; mode: TourMode; initialStep: number }): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(clamp(initialStep, 0, STEPS.length - 1));
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const cleanups = useRef(new Map<string, () => void>());
  const step = STEPS[stepIndex];

  useEffect(() => () => {
    for (const cleanup of [...cleanups.current.values()].reverse()) cleanup();
    cleanups.current.clear();
  }, []);

  useEffect(() => {
    if (step.reveal && !cleanups.current.has(step.reveal)) {
      cleanups.current.set(step.reveal, step.reveal === 'rail' ? railBus.revealForTour() : revealLayoutPanelForTour(step.reveal));
    }
    if (mode === 'first-run') {
      void ipc.store.setOnboarding({ onboarding: { version: ONBOARDING_VERSION, status: 'in-progress', step: stepIndex } });
    }
  }, [mode, step.reveal, stepIndex]);

  useLayoutEffect(() => {
    let timer = 0;
    const locate = (): void => {
      const target = document.querySelector<HTMLElement>(step.target);
      if (!target) {
        setRect(null);
        return;
      }
      const box = target.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) {
        setRect(null);
        return;
      }
      setRect({ left: Math.max(6, box.left - 5), top: Math.max(6, box.top - 5), width: box.width + 10, height: box.height + 10 });
    };
    timer = window.setTimeout(locate, 80);
    window.addEventListener('resize', locate);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', locate);
    };
  }, [step.target, stepIndex]);

  const close = (result: 'completed' | 'skipped' | 'manual'): void => {
    if (mode === 'first-run' && result !== 'manual') {
      void ipc.store.setOnboarding({ onboarding: { version: ONBOARDING_VERSION, status: result, step: 0 } });
    }
    tourBus.clear(id);
  };

  const next = (): void => {
    if (stepIndex === STEPS.length - 1) close(mode === 'first-run' ? 'completed' : 'manual');
    else setStepIndex((value) => value + 1);
  };

  const cardWidth = Math.min(370, window.innerWidth - 32);
  let cardLeft = (window.innerWidth - cardWidth) / 2;
  let cardTop = Math.max(56, window.innerHeight - 300);
  if (rect) {
    if (rect.left + rect.width + cardWidth + 28 < window.innerWidth) cardLeft = rect.left + rect.width + 16;
    else if (rect.left > cardWidth + 28) cardLeft = rect.left - cardWidth - 16;
    cardTop = clamp(rect.top, 48, window.innerHeight - 260);
  }

  return (
    <div className="pd-tour-layer" aria-live="polite">
      {rect ? <div className="pd-tour-highlight" style={rect} aria-hidden="true" /> : <div className="pd-tour-fallback-shade" aria-hidden="true" />}
      <section className="pd-tour-card" role="dialog" aria-modal="false" aria-label={`教學導覽：${step.title}`} style={{ left: cardLeft, top: cardTop, width: cardWidth }}>
        <div className="pd-tour-card-top">
          <span>教學導覽</span>
          <button onClick={() => close(mode === 'first-run' ? 'skipped' : 'manual')} aria-label={mode === 'first-run' ? '略過導覽' : '結束導覽'}>
            {mode === 'first-run' ? '略過' : '結束'}
          </button>
        </div>
        <div className="pd-tour-step-count">{String(stepIndex + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}</div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {!rect ? <div className="pd-tour-fallback-note">目前視窗無法完整顯示目標區域，導覽仍可繼續，不會卡住。</div> : null}
        <div className="pd-tour-footer">
          <div className="pd-tour-dots" aria-hidden="true">{STEPS.map((_, index) => <i key={index} className={index === stepIndex ? 'is-active' : index < stepIndex ? 'is-done' : ''} />)}</div>
          <div>
            <button className="pd-btn" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => Math.max(0, value - 1))}>上一步</button>
            <button className="pd-btn pd-btn-primary" onClick={next}>{stepIndex === STEPS.length - 1 ? '完成' : '下一步'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

let autoTourChecked = false;

export function GuidedTourHost(): React.JSX.Element | null {
  const request = useTourRequest();

  useEffect(() => {
    if (autoTourChecked) return;
    autoTourChecked = true;
    let cancelled = false;
    void ipc.store.getState().then((state) => {
      if (cancelled) return;
      const onboarding = state.onboarding;
      if (onboarding.version === ONBOARDING_VERSION && (onboarding.status === 'completed' || onboarding.status === 'skipped')) return;
      const initialStep = onboarding.version === ONBOARDING_VERSION && onboarding.status === 'in-progress' ? onboarding.step : 0;
      window.setTimeout(() => {
        if (!cancelled) tourBus.start('first-run', initialStep);
      }, 180);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return request ? <GuidedTour key={request.id} id={request.id} mode={request.mode} initialStep={request.initialStep} /> : null;
}
