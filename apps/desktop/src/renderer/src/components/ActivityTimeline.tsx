import type { EventDisplayState, EventView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { eventGlyph, splitActor } from '../lib/events.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Glyph } from './icons.tsx';

// Loud events wear the same ink badge as the tile's unread strip; the rest go quieter.
const BADGES: Record<EventDisplayState, string> = {
  loud: 'bg-ink text-on-ink',
  quiet: 'bg-segment text-muted',
  muted: 'border border-dashed border-dot-quiet bg-surface text-faint',
  seen: 'border border-hairline bg-surface text-faint',
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
  const split = splitActor(summary, actor);
  if (split) {
    return (
      <>
        <span className="font-semibold text-ink">{split.actor}</span>
        {split.rest}
      </>
    );
  }
  return <>{summary}</>;
}

/** Every event on the PR, newest first, with its glyph. Unseen loud ones get the coral "new" dot. */
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
          <div key={view.event.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-2.5" title={`${view.display}: ${reason}`}>
            <span className="flex flex-col items-center">
              <span className={`mt-px flex size-4 items-center justify-center rounded-full ${BADGES[view.display]}`}>
                <Glyph glyph={eventGlyph(view.event.kind)} />
              </span>
              {index < events.length - 1 && <span className="w-px flex-1 bg-hairline" />}
            </span>
            <span className={`pb-2.5 text-[12.5px] leading-[1.45] select-text ${TEXT[view.display]}`}>
              <EventText view={view} />
              {view.display === 'muted' && (
                <button type="button" onClick={() => void actions.unmute(view.event.id)} className="ml-2 text-[11.5px] text-muted underline hover:text-ink">
                  Unmute
                </button>
              )}
            </span>
            <span className="flex items-center gap-1.5 self-start pt-px font-mono text-[10.5px] text-faint">
              {view.display === 'loud' && <span aria-label="New since you looked" className="size-1.5 rounded-full bg-unread" />}
              {ageLabel(view.event.at, now)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
