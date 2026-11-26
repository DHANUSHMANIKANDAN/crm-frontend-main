import { useEffect, useRef } from 'react';

/**
 * Loads the legacy SPA once the React shell has mounted (stable DOM ids for boot()).
 * Views will migrate out of `features/legacy/app.js` into `src/features/<name>/` over time.
 */
export function LegacyBootstrap() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void import('@/features/legacy/app.js');
  }, []);

  return null;
}