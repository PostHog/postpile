import { useEffect, useRef, useState } from 'react';
import type { GitHubWritesStatus } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
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
  return `Locked: read-only. Mark-read stays in the app, approve and comment are blocked. Click to allow GitHub writes.${sample}`;
}

/**
 * The GitHub writes switch in the status footer. Locked = read-only.
 * Unlocking asks first in a small popover; locking is instant. Disabled with
 * the reason when CODE_MANAGER_READ_ONLY=1 forces read-only.
 */
export function WritesLock() {
  const actions = useActions();
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirming) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setConfirming(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setConfirming(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirming]);

  const writes = actions.writes;
  if (!writes) {
    return <span>loading GitHub writes</span>;
  }
  const busy = actions.isBusy('github-writes');

  function onClick() {
    if (writes?.enabled) {
      void actions.setGitHubWrites(false);
    } else {
      setConfirming(!confirming);
    }
  }

  async function allow() {
    setConfirming(false);
    await actions.setGitHubWrites(true);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || writes.forcedOffReason !== null}
        title={lockTitle(writes, actions.config?.fake ?? false)}
        aria-label={writes.enabled ? 'GitHub writes on, click to lock' : 'GitHub writes off (read-only)'}
        aria-pressed={writes.enabled}
        aria-expanded={confirming}
        className={`flex items-center gap-1 rounded px-1 hover:bg-subtle disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent ${writes.enabled ? 'text-ink-2' : 'text-closer'}`}
      >
        {writes.enabled ? <UnlockIcon /> : <LockIcon />}
        {writes.enabled ? 'GitHub writes on' : 'read-only'}
      </button>
      {confirming && (
        <div role="dialog" aria-label="Allow GitHub writes" className="absolute bottom-full left-0 z-20 mb-1.5 flex w-64 flex-col gap-2 rounded-row bg-surface p-3 font-sans shadow-menu">
          <p className="text-[12px] leading-snug text-ink">Mark-read and approvals will reach GitHub.</p>
          <p className="text-[11px] leading-snug text-muted">Mark-reads queued while read-only stay in the app.</p>
          <div className="flex justify-end gap-1.5">
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void allow()}>
              Allow writes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
