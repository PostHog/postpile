import { useCallback, useRef, useState } from 'react';
import type { AvailableUpdate } from '@postpile/core';
import { sendTelemetry } from '../api/telemetry.ts';
import { useUpdate } from '../api/update.ts';
import { laterKey, pillVersion, releaseDate, UPGRADE_COMMAND } from '../lib/update.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { Button } from './Button.tsx';
import { FixCommand } from './FixCommand.tsx';

function isLater(version: string): boolean {
  try {
    return window.localStorage.getItem(laterKey(version)) === '1';
  } catch {
    return false;
  }
}

function rememberLater(version: string): void {
  try {
    window.localStorage.setItem(laterKey(version), '1');
  } catch {
    // Storage can be blocked; the pill then stays hidden until the window reloads.
  }
}

function UpdatePopover(props: { update: AvailableUpdate; current: string; onLater: () => void }) {
  const date = releaseDate(props.update.publishedAt);
  return (
    <div role="dialog" aria-label="Update available" className="absolute top-full right-0 z-30 mt-1 flex w-80 flex-col gap-2.5 rounded-row bg-surface p-3 shadow-menu">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-ink">PostPile {props.update.version}</span>
        {date && <span className="text-[11px] text-muted">Released {date}</span>}
        <span className="text-[11px] text-muted">
          You have <span className="font-mono">{props.current}</span>
        </span>
      </div>
      <a href={props.update.url} target="_blank" rel="noreferrer" className="self-start text-[11.5px] text-ink-2 underline hover:text-ink">
        Release notes
      </a>
      <div className="flex flex-col gap-1 border-t border-hairline pt-2.5">
        <FixCommand command={UPGRADE_COMMAND} label={null} />
        <span className="text-[11px] text-muted">Then quit and reopen PostPile.</span>
      </div>
      <div className="flex justify-end">
        <Button title="Hide this reminder until a newer version is out" onClick={props.onLater}>
          Later
        </Button>
      </div>
    </div>
  );
}

/**
 * "Update available · 0.2.0" in the title bar when the server's last
 * check found a newer release. Neutral on purpose: coral means "new since you
 * looked". The popover has the release notes link and the brew command;
 * "Later" hides the pill for that version (kept in localStorage).
 * Self-contained so it can move when the title bar changes.
 */
export function UpdatePill() {
  const update = useUpdate().data;
  const [open, setOpen] = useState(false);
  const [laterNow, setLaterNow] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  const latest = update?.latest ?? null;
  const later = new Set(laterNow);
  if (latest && isLater(latest.version)) {
    later.add(latest.version);
  }
  const version = pillVersion(update, later);
  if (!update || !latest || version === null) {
    return null;
  }
  function toggle() {
    if (!open) {
      sendTelemetry('update_pill_clicked', {});
    }
    setOpen(!open);
  }
  function hideVersion(hidden: string) {
    sendTelemetry('update_later_clicked', {});
    rememberLater(hidden);
    setLaterNow([...laterNow, hidden]);
    setOpen(false);
  }
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`PostPile ${version} is out; you have ${update.current}`}
        onClick={toggle}
        className="flex h-[22px] items-center gap-1.5 rounded-full border border-frame bg-chip px-2 text-[11px] whitespace-nowrap text-ink-2 hover:bg-subtle hover:text-ink"
      >
        <span className="size-1.5 rounded-full bg-ink-2" />
        Update available · <span className="font-mono text-[10.5px]">{version}</span>
      </button>
      {open && <UpdatePopover update={latest} current={update.current} onLater={() => hideVersion(version)} />}
    </div>
  );
}
