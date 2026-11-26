export type ApiOptions = {
  method?: string;
  body?: unknown;
  quiet?: boolean;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type SriStoreStatus = 'saving' | 'saved' | 'error';

export function dispatchStoreStatus(s: SriStoreStatus) {
  window.dispatchEvent(new CustomEvent('sristore', { detail: s }));
}

export function dispatchStoreDenied(status: number, error: string) {
  window.dispatchEvent(new CustomEvent('sristore-denied', { detail: { status, error } }));
}

export async function apiRequest(path: string, { method = 'GET', body, quiet = false }: ApiOptions = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errBody = (data as { error?: string }).error;
    let message = errBody || res.statusText;
    if (!errBody && (res.status === 500 || res.status === 502 || res.status === 503)) {
      message =
        'Backend API is not reachable on port 8589 — in another terminal run: cd backend && ./gradlew bootRun -PjavaVersion=21';
    }
    const err = new ApiError(res.status, message);
    if (!quiet && (res.status === 401 || res.status === 403)) dispatchStoreDenied(res.status, err.message);
    throw err;
  }
  return data;
}