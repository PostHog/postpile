import { useEffect, useState } from 'react';
import type { CleanupAge, InboxCleanupView } from '@postpile/core';
import { CLEANUP_BUSY, useActions } from '../api/actions.tsx';
import { cleanupChoices, shortDate } from '../lib/cleanup.ts';
import { Button } from './Button.tsx';

function Radio(props: { checked: boolean; onChange: () => void; title: string; note: string }) {
  return (
    <label className={`flex cursor-pointer gap-2.5 rounded-row border px-3 py-2.5 ${props.checked ? 'border-accent-line bg-accent-soft' : 'border-hairline-strong hover:bg-subtle'}`}>
      <input type="radio" checked={props.checked} onChange={props.onChange} className="mt-0.5 accent-[var(--accent)]" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-ink">{props.title}</span>
        <span className="text-[11.5px] leading-snug text-muted">{props.note}</span>
      </span>
    </label>
  );
}

/**
 * "Clean up": mark everything older than 14 / 30 days read on GitHub (one
 * call through the writes lock; locked, it waits as one pending write), or
 * "Not now" (hidden for a week). The local-only "start fresh" is gone: it hid
 * things here that stayed unread on GitHub (DESIGN.md "GitHub unread is
 * PostPile unread").
 */
export function InboxCleanupDialog(props: { view: InboxCleanupView; onClose: () => void }) {
  const actions = useActions();
  const [choice, setChoice] = useState<CleanupAge>(14);
  const { view, onClose } = props;
  const locked = actions.writes?.enabled !== true;
  const busy = Object.values(CLEANUP_BUSY).some((key) => actions.isBusy(key));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    if (await actions.cleanUpInbox(choice)) {
      onClose();
    }
  }

  async function notNow() {
    if (await actions.hideInboxCleanup()) {
      onClose();
    }
  }

  const lockNote = locked
    ? 'GitHub writes are locked: this becomes one pending write in the lock. Nothing changes until you send it.'
    : 'One call to GitHub. It may take a moment; the tiles follow on the next poll.';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Clean up your inbox" className="flex w-[460px] max-w-[calc(100vw-32px)] flex-col gap-3.5 rounded-tile bg-surface p-5 shadow-menu">
        <div className="flex flex-col gap-1">
          <h2 className="text-[14px] font-semibold text-ink">Clean up old unread notifications</h2>
          <p className="text-xs leading-relaxed text-muted">
            GitHub still has {view.unreadOlderThan14} unread {view.unreadOlderThan14 === 1 ? 'thread' : 'threads'} with no activity for 14 days or more.
          </p>
        </div>
        {view.pendingCutoff && (
          <p className="rounded-row bg-subtle px-3 py-2 text-[11.5px] text-ink-2">
            A cleanup (everything before {shortDate(view.pendingCutoff)}) already waits in the lock.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {cleanupChoices(view).map((entry) => (
            <Radio
              key={entry.age}
              checked={choice === entry.age}
              onChange={() => setChoice(entry.age)}
              title={`Mark everything older than ${entry.age} days read on GitHub`}
              note={`${entry.count} unread ${entry.count === 1 ? 'thread' : 'threads'} here. ${lockNote}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void notNow()} disabled={busy} title="Hides the cleanup for 7 days">
            Not now
          </Button>
          <span className="ml-auto" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            title={actions.blockedReason('cleanup') ?? lockNote}
            onClick={() => void confirm()}
          >
            {locked ? 'Add pending write' : 'Mark read on GitHub'}
          </Button>
        </div>
      </div>
    </div>
  );
}
