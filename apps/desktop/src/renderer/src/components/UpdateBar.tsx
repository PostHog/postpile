import { useEffect } from 'react';
import { sendTelemetry } from '../api/telemetry.ts';
import { behindSinceDate, releasesBehindText } from '../lib/update.ts';
import { useUpdateReminder } from '../lib/use-update-reminder.ts';
import { Button } from './Button.tsx';
import { UpdateNextStep } from './UpdateNextStep.tsx';

const RELEASES_CAP = 10;

// The bar's first show is reported once per app run, not on every remount or minute tick.
let shownReported = false;

/**
 * The update reminder after 24h behind: a full-width bar under the title bar.
 * Calm amber, not coral (coral means "new since you looked"). Core decides
 * when it shows (updateUrgency) and what it offers (updateAction); "Later"
 * drops it back to the pill for 24h.
 */
export function UpdateBar() {
  const { view, urgency, hoursBehind, action, version, later, restart } = useUpdateReminder();
  const latest = view?.latest ?? null;
  const visible = urgency === 'bar' && latest !== null;

  useEffect(() => {
    if (!visible || shownReported) {
      return;
    }
    shownReported = true;
    sendTelemetry('update_bar_shown', {
      releases_behind: Math.min(latest.releasesBehind, RELEASES_CAP),
      hours_behind: Math.round(hoursBehind ?? 0),
    });
  }, [visible, latest, hoursBehind]);

  if (!visible) {
    return null;
  }
  const since = behindSinceDate(latest.behindSince);
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-line bg-amber-soft px-3 py-1.5 text-[12px] text-amber-ink">
      <span className="size-1.5 shrink-0 rounded-full bg-amber" />
      <span>
        You&apos;re <span className="font-semibold">{releasesBehindText(latest.releasesBehind, latest.moreBehind)}</span> behind{since && ` (since ${since})`}. PostPile{' '}
        <span className="font-mono text-[11px]">{version ?? latest.version}</span> {action === 'restart' ? 'is ready to install.' : 'is out.'}
      </span>
      <UpdateNextStep action={action} onRestart={restart} hintClass="" />
      <div className="ml-auto flex items-center gap-3">
        <a href={latest.url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          Release notes
        </a>
        <Button
          title="Back to the small pill for 24 hours"
          onClick={() => {
            sendTelemetry('update_bar_later_clicked', {});
            later();
          }}
        >
          Later
        </Button>
      </div>
    </div>
  );
}
