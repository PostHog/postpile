import { useCallback, useRef, useState } from 'react';
import type { AvailableUpdate, UpdateAction } from '@postpile/core';
import { sendTelemetry } from '../api/telemetry.ts';
import { releaseDate } from '../lib/update.ts';
import { useUpdateReminder } from '../lib/use-update-reminder.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { Button } from './Button.tsx';
import { UpdateNextStep } from './UpdateNextStep.tsx';

function UpdatePopover(props: { update: AvailableUpdate; current: string; action: UpdateAction; onRestart: () => void; onLater: () => void }) {
  const date = releaseDate(props.update.publishedAt);
  return (
    <div role="dialog" aria-label={props.action === 'restart' ? 'Update ready' : 'Update available'} className="absolute top-full right-0 z-30 mt-1 flex w-80 flex-col gap-2.5 rounded-row bg-surface p-3 shadow-menu">
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
      <div className="flex flex-col items-start gap-1 border-t border-hairline pt-2.5">
        <UpdateNextStep action={props.action} onRestart={props.onRestart} hintClass="text-[11px] text-muted" />
      </div>
      <div className="flex justify-end">
        <Button title="Remind me again later" onClick={props.onLater}>
          Later
        </Button>
      </div>
    </div>
  );
}

/**
 * "Update available · 0.2.0" in the title bar when the server's last
 * check found a newer release, "Update ready · 0.2.0" once the app has
 * downloaded it. Neutral on purpose: coral means "new since you looked". The
 * popover has the release notes link and the next step (UpdateNextStep):
 * restart, wait for the download, or the brew command.
 * Under 24h behind this is the whole reminder and "Later" hides it until the
 * bar takes over; the bar's own "Later" drops back to this pill for 24h.
 * Self-contained so it can move when the title bar changes.
 */
export function UpdatePill() {
  const { view: update, urgency, action, later, restart } = useUpdateReminder();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  const latest = update?.latest ?? null;
  if (!update || !latest || urgency !== 'pill') {
    return null;
  }
  function toggle() {
    if (!open) {
      sendTelemetry('update_pill_clicked', {});
    }
    setOpen(!open);
  }
  function snooze() {
    sendTelemetry('update_later_clicked', {});
    later();
    setOpen(false);
  }
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={action === 'restart' ? `PostPile ${latest.version} is ready to install; you have ${update.current}` : `PostPile ${latest.version} is out; you have ${update.current}`}
        onClick={toggle}
        className="flex h-[22px] items-center gap-1.5 rounded-full border border-frame bg-chip px-2 text-[11px] whitespace-nowrap text-ink-2 hover:bg-subtle hover:text-ink"
      >
        <span className="size-1.5 rounded-full bg-ink-2" />
        {action === 'restart' ? 'Update ready' : 'Update available'} · <span className="font-mono text-[10.5px]">{latest.version}</span>
      </button>
      {open && <UpdatePopover update={latest} current={update.current} action={action} onRestart={restart} onLater={snooze} />}
    </div>
  );
}
