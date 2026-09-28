import { useState } from 'react';
import type { ActivityLine, ActivityList, EventDisplayState, EventKind, EventView } from '@postpile/core';
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
function LineText(props: { summary: string; actor: string }) {
  const split = splitActor(props.summary, props.actor);
  if (split) {
    return (
      <>
        <span className="font-semibold text-ink">{split.actor}</span>
        {split.rest}
      </>
    );
  }
  return <>{props.summary}</>;
}

interface RowProps {
  kind: EventKind;
  actor: string;
  summary: string;
  at: string;
  display: EventDisplayState;
  /** Why the rules (or the agent) classed it so, for the hover title. */
  reason: string;
  last: boolean;
  /** The event id to unmute, on agent-muted events. */
  unmuteId: string | null;
}

function ActivityRow(props: RowProps) {
  const actions = useActions();
  const now = useNow();
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-2.5" title={`${props.display}: ${props.reason}`}>
      <span className="flex flex-col items-center">
        <span className={`mt-px flex size-4 items-center justify-center rounded-full ${BADGES[props.display]}`}>
          <Glyph glyph={eventGlyph(props.kind)} />
        </span>
        {!props.last && <span className="w-px flex-1 bg-hairline" />}
      </span>
      <span className={`pb-2.5 text-[12.5px] leading-[1.45] select-text ${TEXT[props.display]}`}>
        <LineText summary={props.summary} actor={props.actor} />
        {props.unmuteId && (
          <button type="button" onClick={() => void actions.unmute(props.unmuteId!)} className="ml-2 text-[11.5px] text-muted underline hover:text-ink">
            Unmute
          </button>
        )}
      </span>
      <span className="flex items-center gap-1.5 self-start pt-px font-mono text-[10.5px] text-faint">
        {props.display === 'loud' && <span aria-label="New since you looked" className="size-1.5 rounded-full bg-unread" />}
        {ageLabel(props.at, now)}
      </span>
    </div>
  );
}

function lineRow(line: ActivityLine, last: boolean) {
  const newest = line.events[0]!.event;
  const reason = line.events.length > 1 ? `${line.events.length} events` : (newest.override?.reason ?? newest.ruleReason);
  return <ActivityRow key={line.id} kind={line.kind} actor={line.actor} summary={line.summary} at={line.at} display={line.display} reason={reason} last={last} unmuteId={null} />;
}

function eventRow(view: EventView, last: boolean) {
  const { event } = view;
  return (
    <ActivityRow
      key={event.id}
      kind={event.kind}
      actor={event.actor}
      summary={event.summary}
      at={event.at}
      display={view.display}
      reason={event.override?.reason ?? event.ruleReason}
      last={last}
      unmuteId={view.display === 'muted' ? event.id : null}
    />
  );
}

const sectionLabel = 'pb-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase';
const linkButton = 'self-start text-[11.5px] text-accent hover:underline';

/**
 * The PR's meaningful activity from core (`PrDetail.activity`): new since
 * you looked first, set apart, then the rest; about a dozen lines before
 * "Show all N". Bot and CI noise is one line that expands.
 */
export function ActivityTimeline(props: { activity: ActivityList }) {
  const [showAll, setShowAll] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const { fresh, earlier, noise } = props.activity;
  const total = fresh.length + earlier.length;
  const room = showAll ? total : props.activity.cap;
  const shownFresh = fresh.slice(0, room);
  const shownEarlier = earlier.slice(0, Math.max(0, room - shownFresh.length));
  return (
    <div className="flex flex-col">
      <span className="pb-2 text-[11px] font-semibold tracking-[0.04em] text-muted">Activity</span>
      {total === 0 && noise.length === 0 && <span className="text-xs text-faint">No activity yet.</span>}
      {shownFresh.length > 0 && (
        <div className="mb-2 flex flex-col rounded-row border border-unread-border bg-unread-row px-2.5 pt-2">
          <span className={`${sectionLabel} text-unread-ink`}>New since you looked</span>
          {shownFresh.map((line, index) => lineRow(line, index === shownFresh.length - 1))}
        </div>
      )}
      {shownFresh.length > 0 && shownEarlier.length > 0 && <span className={`${sectionLabel} text-faint`}>Earlier</span>}
      {shownEarlier.map((line, index) => lineRow(line, index === shownEarlier.length - 1))}
      {total > props.activity.cap && (
        <button type="button" className={linkButton} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${total}`}
        </button>
      )}
      {noise.length > 0 && (
        <div className="mt-2 flex flex-col">
          <button type="button" aria-expanded={showNoise} className={`${linkButton} text-muted`} onClick={() => setShowNoise(!showNoise)}>
            {showNoise ? 'Hide' : 'Show'} {props.activity.noiseLabel}
          </button>
          {showNoise && <div className="mt-2 flex flex-col">{noise.map((view, index) => eventRow(view, index === noise.length - 1))}</div>}
        </div>
      )}
    </div>
  );
}
