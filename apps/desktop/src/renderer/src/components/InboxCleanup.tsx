import { useState } from 'react';
import { useInboxCleanup } from '../api/cleanup.ts';
import { backlogText } from '../lib/cleanup.ts';
import { Button } from './Button.tsx';
import { InboxCleanupDialog } from './InboxCleanupDialog.tsx';

/**
 * The inbox cleanup entry, in one of two places: `line` is the quiet line
 * in the sidebar footer, `banner` the prominent one at the top of the
 * middle column (first run, or back after 5+ days). Each renders only when
 * the server's `look` asks for it.
 */
export function InboxCleanup(props: { place: 'line' | 'banner' }) {
  const cleanup = useInboxCleanup();
  const [open, setOpen] = useState(false);
  const view = cleanup.data;
  if (!view) {
    return null;
  }
  // The banner replaces the line while it shows.
  const shown = props.place === 'banner' ? view.look === 'banner' : view.look === 'line';
  const dialog = open && <InboxCleanupDialog view={view} onClose={() => setOpen(false)} />;
  if (!shown) {
    return dialog || null;
  }
  if (props.place === 'line') {
    return (
      <>
        <p className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-hint">
          <span className="truncate">{backlogText(view)}</span>
          <span>·</span>
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 text-muted hover:text-ink hover:underline">
            Clean up
          </button>
        </p>
        {dialog}
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-3 rounded-tile border border-hairline-strong bg-surface px-4 py-3 shadow-tile">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13px] font-semibold text-ink">{backlogText(view)} on GitHub</p>
          <p className="text-xs text-muted">Mark them read on GitHub in one go.</p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setOpen(true)}>
          Clean up
        </Button>
      </div>
      {dialog}
    </>
  );
}
