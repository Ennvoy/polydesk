import { useSyncExternalStore } from 'react';

export type TourMode = 'first-run' | 'manual';

export interface TourRequest {
  id: number;
  mode: TourMode;
  initialStep: number;
}

let request: TourRequest | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const tourBus = {
  start(mode: TourMode = 'manual', initialStep = 0): void {
    request = { id: ++sequence, mode, initialStep };
    emit();
  },
  clear(id: number): void {
    if (request?.id !== id) return;
    request = null;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): TourRequest | null {
    return request;
  },
};

export function useTourRequest(): TourRequest | null {
  return useSyncExternalStore(tourBus.subscribe, tourBus.getSnapshot, tourBus.getSnapshot);
}
