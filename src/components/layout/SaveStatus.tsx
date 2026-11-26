import { useSriStoreStatus } from '@/hooks/useSriStoreStatus';

/** Sync indicator — legacy app also sets #saveState via the same sristore events. */
export function SaveStatus() {
  const { status, label, color } = useSriStoreStatus();

  return (
    <span
      className="save-state"
      id="saveState"
      title="Database sync status"
      data-state={status ?? undefined}
      style={{ ['--c' as string]: color }}
    >
      {label}
    </span>
  );
}