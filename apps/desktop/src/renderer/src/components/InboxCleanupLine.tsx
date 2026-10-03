import { useState } from 'react';
import { useInboxCleanup } from '../api/cleanup.ts';
import { CLEANUP_PENDING_NOTE, cleanupLine } from '../lib/cleanup.ts';
import { InboxCleanupDialog } from './InboxCleanupDialog.tsx';
import { MergeIcon, TrashIcon } from './icons.tsx';

/**
 * The inbox cleanup's quiet line in the sidebar footer, any day: "12 merged
 * PRs · Clear" (or "N old notifications · Clear" with no merged PR unread),
 * "Clearing 84 / 191" while a run goes. Clear opens the dialog in sidebar
 * mode. The items sit in one flex row, so a second one can join later.
 */
export function InboxCleanupLine() {
  const view = useInboxCleanup().data;
  const [open, setOpen] = useState(false);
  const line = view ? cleanupLine(view) : null;
  if (!view || line === null) {
    return null;
  }
  return (
    <>
      <p className="flex flex-wrap items-center gap-1.5 px-2.5 py-1 text-[11px] text-hint">
        {line.kind === 'merged' && <MergeIcon size={12} className="shrink-0 text-merged" />}
        {line.kind === 'running' && <TrashIcon size={12} className="shrink-0 text-muted" />}
        <span className={`truncate ${line.kind === 'running' ? 'font-mono tabular-nums' : ''}`}>{line.text}</span>
        {line.kind !== 'running' && (
          <button
            type="button"
            disabled={view.pending}
            title={view.pending ? CLEANUP_PENDING_NOTE : undefined}
            onClick={() => setOpen(true)}
            className="shrink-0 text-muted hover:text-ink hover:underline disabled:opacity-50 disabled:hover:text-muted disabled:hover:no-underline"
          >
            Clear
          </button>
        )}
      </p>
      {open && <InboxCleanupDialog mode={{ kind: 'sidebar' }} view={view} onClose={() => setOpen(false)} />}
    </>
  );
}
