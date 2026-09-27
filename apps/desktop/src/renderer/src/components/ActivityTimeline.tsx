import type { EventDisplayState, EventView } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';

const DOTS: Record<EventDisplayState, string> = {
  loud: 'border-unread bg-unread ring-3 ring-unread/15',
  quiet: 'border-dot-quiet bg-dot-quiet',
  muted: 'border-dashed border-dot-quiet bg-surface',
  seen: 'border-dot-quiet bg-surface',
};

const TEXT: Record<EventDisplayState, string> = {
  loud: 'font-medium text-ink',
  quiet: 'text-ink-2',
  muted: 'text-faint',
  seen: 'text-muted',
};

/** Summaries start with the actor ("lyra mentioned you"); that part is drawn bold. */
function EventText(props: { view: EventView }) {
  const { actor, summary } = props.view.event;
  if (actor && summary.startsWith(`${actor} `)) {
    return (
      <>
        <span className="font-semibold text-ink">{actor}</span>
        {summary.slice(actor.length)}
      </>
    );
  }
  return <>{summary}</>;
}

/** Every event on the PR, newest first, dotted by loudness. Muted ones can be unmuted. */
export function ActivityTimeline(props: { events: EventView[] }) {
  const actions = useActions();
  const now = useNow();
  const events = [...props.events].sort((a, b) => (a.event.at < b.event.at ? 1 : -1));
  return (
    <div className="flex flex-col">
      <span className="pb-2 text-[11px] font-semibold tracking-[0.04em] text-muted">Activity</span>
      {events.length === 0 && <span className="text-xs text-faint">No activity yet.</span>}
      {events.map((view, index) => {
        const reason = view.event.override?.reason ?? view.event.ruleReason;
        return (
          <div key={view.event.id} className="grid grid-cols-[12px_minmax(0,1fr)_auto] gap-2.5" title={`${view.display}: ${reason}`}>
            <span className="flex flex-col items-center">
              <span className={`mt-1 size-2 rounded-full border-[1.5px] ${DOTS[view.display]}`} />
              {index < events.length - 1 && <span className="w-px flex-1 bg-hairline" />}
            </span>
            <span className={`pb-2.5 text-[12.5px] leading-[1.45] select-text ${TEXT[view.display]}`}>
              <EventText view={view} />
              {view.display === 'muted' && (
                <button type="button" onClick={() => void actions.unmute(view.event.id)} className="ml-2 text-[11.5px] text-accent hover:underline">
                  Unmute
                </button>
              )}
            </span>
            <span className="pt-px font-mono text-[10.5px] text-faint">{ageLabel(view.event.at, now)}</span>
          </div>
        );
      })}
    </div>
  );
}
