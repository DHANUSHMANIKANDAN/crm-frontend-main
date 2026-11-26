import { useEffect, useState } from 'react';
import type { SriStoreStatus } from '@/lib/api';

const STATUS_LABEL: Record<SriStoreStatus, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
};

const STATUS_COLOR: Record<SriStoreStatus, string> = {
  saving: 'var(--warn)',
  saved: 'var(--ok)',
  error: 'var(--bad)',
};

export function useSriStoreStatus() {
  const [status, setStatus] = useState<SriStoreStatus | null>(null);

  useEffect(() => {
    const onStore = (e: Event) => {
      setStatus((e as CustomEvent<SriStoreStatus>).detail);
    };
    window.addEventListener('sristore', onStore);
    return () => window.removeEventListener('sristore', onStore);
  }, []);

  return {
    status,
    label: status ? STATUS_LABEL[status] : '',
    color: status ? STATUS_COLOR[status] : 'var(--faint)',
  };
}