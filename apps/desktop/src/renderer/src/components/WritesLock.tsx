import { useEffect, useRef } from 'react';
import type { GitHubWritesStatus, PendingWriteView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { pendingBadgeTitle, pendingHeadline, pendingList } from '../lib/pending.ts';
import { Button } from './Button.tsx';
import { LockIcon, UnlockIcon } from './icons.tsx';

function lockTitle(writes: GitHubWritesStatus, fake: boolean): string {
  const sample = fake ? ' Sample data: nothing leaves the app either way.' : '';
  if (writes.forcedOffReason) {
    return `Locked: read-only. ${writes.forcedOffReason}${sample}`;
  }
  if (writes.enabled) {
    return `Unlocked: mark-read, approvals and comments reach GitHub. Click to lock (read-only).${sample}`;
  }
  return `Locked: read-only. Mark-reads wait as pending writes, approve and comment are blocked. Click to allow GitHub writes.${sample}`;
}

/** The first few pending writes by title; a failed one says why on hover. */
function PendingList(props: { pending: PendingWriteView[] }) {
  const { shown, more } = pendingList(props.pending);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-ink-2">{pendingHeadline(props.pending)}</p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((write) => (
          <li key={write.id} className="flex items-baseline gap-1.5 text-[11px] leading-snug" title={write.error ?? write.prKeys.join(', ')}>
            <span className={`shrink-0 ${write.error ? 'text-status-bad' : 'text-faint'}`}>{write.error ? '!' : '·'}</span>
            <span className="min-w-0 truncate text-ink-2">{write.title}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="text-[11px] text-faint">+{more} more</p>}
    </div>
  );
}

/**
 * The GitHub writes switch in the status footer. Locked = read-only.
 * Unlocking asks first in a small popover, which lists the mark-reads made
 * while locked (pending writes) and offers to send or discard them; locking
 * is instant unless pending writes are left. The count badge shows how many
 * wait. With POSTPILE_READ_ONLY=1 it cannot unlock; the popover then only
 * offers to discard. Whether the popover is open lives in App, so the busy
 * inbox card's "Unlock writes" can open it too.
 */
export function WritesLock(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useActions();
  const { open, onOpenChange: setOpen } = props;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  const writes = actions.writes;
  if (!writes) {
    return <span>loading GitHub writes</span>;
  }
  const busy = actions.isBusy('github-writes');
  const pending = writes.pending;
  const count = pending.length;
  const forced = writes.forcedOffReason !== null;

  function onClick() {
    if (writes?.enabled && count === 0) {
      void actions.setGitHubWrites(false);
    } else {
      setOpen(!open);
    }
  }

  async function unlockThen(next: 'send' | 'discard' | null) {
    setOpen(false);
    const unlocked = writes?.enabled || (await actions.setGitHubWrites(true));
    if (!unlocked) {
      return;
    }
    if (next === 'send') {
      await actions.sendPendingWrites();
    } else if (next === 'discard') {
      await actions.discardPendingWrites();
    }
  }

  async function discardOnly() {
    setOpen(false);
    await actions.discardPendingWrites();
  }

  async function lock() {
    setOpen(false);
    await actions.setGitHubWrites(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || (forced && count === 0)}
        title={lockTitle(writes, actions.config?.fake ?? false)}
        aria-label={writes.enabled ? 'GitHub writes on, click to lock' : 'GitHub writes off (read-only)'}
        aria-pressed={writes.enabled}
        aria-expanded={open}
        className={`flex items-center gap-[5px] rounded px-1 hover:bg-subtle disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent ${writes.enabled ? 'text-ink-2' : 'text-amber-ink'}`}
      >
        {writes.enabled ? <UnlockIcon size={11} /> : <LockIcon size={11} />}
        {writes.enabled ? 'GitHub writes on' : 'read-only'}
        {count > 0 && (
          <span title={pendingBadgeTitle(pending)} className="ml-0.5 rounded-full bg-segment px-1.5 text-[10px] leading-[15px] font-semibold text-ink-2">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={writes.enabled ? 'Pending GitHub writes' : 'Allow GitHub writes'}
          className="absolute bottom-full left-0 z-20 mb-1.5 flex w-72 flex-col gap-2.5 rounded-row bg-surface p-3 font-sans shadow-menu"
        >
          {forced ? (
            <p className="text-[12px] leading-snug text-ink">{writes.forcedOffReason}</p>
          ) : (
            !writes.enabled && <p className="text-[12px] leading-snug text-ink">Mark-read and approvals will reach GitHub.</p>
          )}
          {writes.enabled && <p className="text-[12px] leading-snug text-ink">These did not reach GitHub yet.</p>}
          {count > 0 && <PendingList pending={pending} />}
          {count > 0 && (
            <p className="text-[11px] leading-snug text-muted">
              Made while locked, nothing changed in the app yet. Send marks them read on GitHub (then here); Discard drops them and the tiles stay unread, like on GitHub.
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            {forced && (
              <>
                <Button onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={() => void discardOnly()}>Discard pending</Button>
              </>
            )}
            {!forced && !writes.enabled && count === 0 && (
              <>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => void unlockThen(null)}>
                  Allow writes
                </Button>
              </>
            )}
            {!forced && !writes.enabled && count > 0 && (
              <>
                <Button onClick={() => setOpen(false)} title="Stay locked; the pending writes keep waiting.">
                  Cancel
                </Button>
                <Button onClick={() => void unlockThen('discard')} title="Unlock, and drop the pending writes. The tiles stay unread, like on GitHub.">
                  Discard
                </Button>
                <Button variant="primary" onClick={() => void unlockThen('send')}>
                  Send {count} to GitHub
                </Button>
              </>
            )}
            {writes.enabled && (
              <>
                <Button onClick={() => void lock()} title="Lock; the pending writes keep waiting.">
                  Lock
                </Button>
                <Button onClick={() => void discardOnly()}>Discard</Button>
                <Button variant="primary" onClick={() => void unlockThen('send')}>
                  Send {count} to GitHub
                </Button>
              </>
            )}
          </div>
          {!forced && !writes.enabled && count > 0 && (
            <button
              type="button"
              onClick={() => void discardOnly()}
              className="self-end text-[11px] text-muted underline decoration-hairline-strong underline-offset-2 hover:text-ink"
              title="Drop the pending writes without unlocking. The tiles stay unread, like on GitHub."
            >
              Discard pending, stay locked
            </button>
          )}
        </div>
      )}
    </div>
  );
}
