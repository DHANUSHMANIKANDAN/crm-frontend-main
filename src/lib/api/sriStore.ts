/**
 * Persistence client for SriLead — backed by PostgreSQL via /api/state.
 * Also exposed as window.SriStore for the legacy UI layer during migration.
 */

import {
  apiRequest,
  ApiError,
  dispatchStoreStatus,
  type SriStoreStatus,
} from './client';

export type { SriStoreStatus };
export { ApiError };

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: unknown = null;
let inflight: Promise<void> = Promise.resolve();

function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending) return inflight;
  const snap = pending;
  pending = null;
  dispatchStoreStatus('saving');
  inflight = inflight
    .then(() => apiRequest('/api/state', { method: 'PUT', body: snap }))
    .then(() => {
      dispatchStoreStatus('saved');
    })
    .catch((e) => {
      console.error('SriStore save failed', e);
      dispatchStoreStatus('error');
    });
  return inflight;
}

export const SriStore = {
  api: apiRequest,
  ApiError,
  load: () => apiRequest('/api/state'),
  save(db: unknown) {
    pending = JSON.parse(JSON.stringify(db));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 400);
  },
  flush,
  discard() {
    pending = null;
    if (timer) clearTimeout(timer);
    timer = null;
  },
  async reset() {
    pending = null;
    if (timer) clearTimeout(timer);
    timer = null;
    await apiRequest('/api/state', { method: 'DELETE' });
  },
};

export function attachSriStore() {
  window.SriStore = SriStore;
  window.addEventListener('beforeunload', () => {
    if (pending) {
      navigator.sendBeacon?.(
        '/api/state',
        new Blob([JSON.stringify(pending)], { type: 'application/json' }),
      );
    }
  });
}

declare global {
  interface Window {
    SriStore: typeof SriStore;
  }
}