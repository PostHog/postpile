import { useState } from 'react';
import type { ActivityLine, ActivityList, EventDisplayState, EventKind, EventView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { eventGlyph, splitActor, summaryLead } from '../lib/events.ts';
import { ageLabel, clockLabel, whenLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Glyph } from './icons.tsx';
import { SectionLabel } from './SectionLabel.tsx';
import { MarkdownText } from './MarkdownText.tsx';

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
  /** The full text of a human comment or review, shown under the line. */
  body: string | null;
  at: string;
  display: EventDisplayState;
  /** The event's own seen state is unseen (from core): the coral unread dot. */
  unseen: boolean;
  /** Why the rules (or the agent) classed it so, for the hover title. */
  reason: string;
  last: boolean;
  /** The event id to unmute, on agent-muted events. */
  unmuteId: string | null;
}

function UnseenDot() {
  return <span aria-label="Unseen" className="size-1.5 rounded-full bg-unread" />;
}

function ActivityRow(props: RowProps) {
  const actions = useActions();
  const now = useNow();
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-2" title={`${props.display}: ${props.reason}`}>
      <span className="flex flex-col items-center">
        <span className={`mt-px flex size-4 items-center justify-center rounded-full ${BADGES[props.display]}`}>
          <Glyph glyph={eventGlyph(props.kind)} />
        </span>
        {!props.last && <span className="w-px flex-1 bg-hairline" />}
      </span>
      <span className={`pb-2.5 text-[12.5px] leading-[1.45] select-text ${TEXT[props.display]}`}>
        <LineText summary={props.body ? summaryLead(props.summary) : props.summary} actor={props.actor} />
        {props.body && <div className="mt-0.5 font-normal break-words [overflow-wrap:anywhere]">
            <MarkdownText text={props.body} compact />
          </div>}
        {props.unmuteId && (
          <button type="button" onClick={() => void actions.unmute(props.unmuteId!)} className="ml-2 text-[11.5px] text-muted underline hover:text-ink">
            Unmute
          </button>
        )}
      </span>
      <span className="flex items-center gap-1.5 self-start pt-px font-mono text-[10.5px] text-faint">
        {props.unseen && <UnseenDot />}
        {ageLabel(props.at, now)}
      </span>
    </div>
  );
}

export function lineRow(line: ActivityLine, last: boolean) {
  const newest = line.events[0]!.event;
  const reason = line.events.length > 1 ? `${line.events.length} events` : (newest.override?.reason ?? newest.ruleReason);
  return <ActivityRow key={line.id} kind={line.kind} actor={line.actor} summary={line.summary} body={line.body} at={line.at} display={line.display} unseen={line.unseen} reason={reason} last={last} unmuteId={null} />;
}

export function eventRow(view: EventView, last: boolean) {
  const { event } = view;
  return (
    <ActivityRow
      key={event.id}
      kind={event.kind}
      actor={event.actor}
      summary={event.summary}
      body={null}
      at={event.at}
      display={view.display}
      unseen={view.unseen}
      reason={event.override?.reason ?? event.ruleReason}
      last={last}
      unmuteId={view.display === 'muted' ? event.id : null}
    />
  );
}

/**
 * The unread tile has no event to show for it: GitHub changed the
 * notification after the last known event. One dotted line, top of the list.
 */
function ThreadChangeRow(props: { at: string; last: boolean }) {
  const now = useNow();
  const when = new Date(props.at);
  const sameDay = when.toDateString() === now.toDateString();
  const time = sameDay ? `at ${clockLabel(when)}` : `${whenLabel(props.at, now)}, ${clockLabel(when)}`;
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-2" title="The notification is unread on GitHub, but no event explains it.">
      <span className="flex flex-col items-center">
        <span className={`mt-px flex size-4 items-center justify-center rounded-full ${BADGES.muted}`}>
          <span className="size-1 rounded-full bg-faint" />
        </span>
        {!props.last && <span className="w-px flex-1 bg-hairline" />}
      </span>
      <span className="pb-2.5 text-[12.5px] leading-[1.45] text-ink-2 select-text">GitHub changed the notification {time}, nothing PostPile can show</span>
      <span className="flex items-center gap-1.5 self-start pt-px font-mono text-[10.5px] text-faint">
        <UnseenDot />
        {ageLabel(props.at, now)}
      </span>
    </div>
  );
}

export const linkButton = 'self-start text-[11.5px] text-accent hover:underline';

/**
 * The PR's earlier activity from core (`PrDetail.activity`); what is new
 * since you looked sits in `NewSinceBox` under the title, not here again.
 * About a dozen lines before "Show all N". Bot and CI noise is one line
 * that expands.
 */
export function ActivityTimeline(props: { activity: ActivityList }) {
  const [showAll, setShowAll] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const { fresh, earlier, noise } = props.activity;
  const shown = showAll ? earlier : earlier.slice(0, props.activity.cap);
  const { threadChangedAt } = props.activity;
  const empty = earlier.length === 0 && noise.length === 0 && threadChangedAt === null;
  return (
    <div className="flex flex-col px-3">
      <span className="pb-2">
        <SectionLabel>{fresh.length > 0 ? 'Earlier activity' : 'Activity'}</SectionLabel>
      </span>
      {empty && <span className="text-xs text-hint">{fresh.length > 0 ? 'Nothing before that.' : 'No activity yet.'}</span>}
      {threadChangedAt !== null && <ThreadChangeRow at={threadChangedAt} last={earlier.length === 0 && noise.length === 0} />}
      {shown.map((line, index) => lineRow(line, index === shown.length - 1))}
      {earlier.length > props.activity.cap && (
        <button type="button" className={linkButton} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${earlier.length}`}
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
