// SriStore — persistence client for the SriLead app, backed by PostgreSQL via /api/state.
// Load before app.js. Usage:
//   const { empty, state } = await SriStore.load();   // state is already filtered to what you may see
//   SriStore.save(db);                                // debounced; call after every mutation
//   await SriStore.flush();                           // force pending save now
//   await SriStore.reset();                           // wipe CRM data, keep the team (admin only)
//   SriStore.api(path, options)                       // fetch JSON from the backend, with auth handling
// Events on window:
//   'sristore'        detail: 'saving' | 'saved' | 'error'
//   'sristore-denied' detail: { status, error }   — 401 (signed out) or 403 (role doesn't allow it)
(function () {
  let timer = null, pending = null, inflight = Promise.resolve();
  const onStatus = (s) => window.dispatchEvent(new CustomEvent('sristore', { detail: s }));
  const onDenied = (status, error) => window.dispatchEvent(new CustomEvent('sristore-denied', { detail: { status, error } }));

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(path, { method = 'GET', body, quiet = false } = {}) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new ApiError(res.status, data.error || res.statusText);
      if (!quiet && (res.status === 401 || res.status === 403)) onDenied(res.status, err.message);
      throw err;
    }
    return data;
  }

  function flush() {
    clearTimeout(timer);
    if (!pending) return inflight;
    const snap = pending; pending = null;
    onStatus('saving');
    inflight = inflight
      .then(() => api('/api/state', { method: 'PUT', body: snap }))
      .then(() => onStatus('saved'))
      .catch((e) => { console.error('SriStore save failed', e); onStatus('error'); });
    return inflight;
  }

  window.SriStore = {
    api,
    ApiError,
    load: () => api('/api/state'),
    save(db) {
      pending = JSON.parse(JSON.stringify(db));
      clearTimeout(timer);
      timer = setTimeout(flush, 400);
    },
    flush,
    /** Drops unsaved changes (used after a refused save, before reloading from the server). */
    discard() { pending = null; clearTimeout(timer); },
    async reset() {
      pending = null; clearTimeout(timer);
      await api('/api/state', { method: 'DELETE' });
    },
  };
  window.addEventListener('beforeunload', () => {
    if (pending) navigator.sendBeacon?.('/api/state', new Blob([JSON.stringify(pending)], { type: 'application/json' }));
  });
})();
