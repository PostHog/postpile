import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActivityLine, ActivityList, EventDisplayState, EventKind, EventView, Pr } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { eventGlyph, splitActor, summaryLead } from '../lib/events.ts';
import { replyCopy, replyTargetOf, type ReplyTarget } from '../lib/reply.ts';
import { ageLabel, clockLabel, whenLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { Composer, useCompose } from './Composer.tsx';
import { Glyph, ReplyIcon, ThumbsUpIcon } from './icons.tsx';
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
  /** Under the text: Reply and React on a person's comment, or "Reply ↓" in "New since". */
  below?: ReactNode;
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
        {props.below}
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

export function lineRow(line: ActivityLine, last: boolean, below: ReactNode = null) {
  const newest = line.events[0]!.event;
  const reason = line.events.length > 1 ? `${line.events.length} events` : (newest.override?.reason ?? newest.ruleReason);
  return (
    <ActivityRow
      key={line.id}
      kind={line.kind}
      actor={line.actor}
      summary={line.summary}
      body={line.body}
      at={line.at}
      display={line.display}
      unseen={line.unseen}
      reason={reason}
      last={last}
      unmuteId={null}
      below={below}
    />
  );
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
 * Reply and React under a person's comment. Reply is a button when the line
 * asks the viewer something, else a quiet link; a thumbs up the viewer gave
 * shows as a pressed pill. Reply opens the pane's composer right here.
 */
function TalkActions(props: { prKey: string; target: ReplyTarget }) {
  const actions = useActions();
  const compose = useCompose();
  const { target } = props;
  const replyOpen = compose.open?.kind === 'reply' && compose.open.commentId === target.commentId;
  const replyBlocked = actions.blockedReason('reply');
  const reactBlocked = actions.blockedReason('react');
  const copy = replyCopy(target);
  const replyLabel = target.inThread ? 'Reply in thread' : 'Reply';
  return (
    <div className="mt-1.5 flex flex-col gap-2 font-normal">
      <span className="flex items-center gap-1">
        {target.canReply && (
          <Button
            variant={target.asksYou ? 'secondary' : 'quiet'}
            className={target.asksYou ? '' : '-ml-2.5'}
            disabled={replyBlocked !== null}
            aria-expanded={replyOpen}
            title={replyBlocked ?? `${copy.title}: ${copy.hint}`}
            onClick={() => compose.openTarget({ kind: 'reply', commentId: target.commentId })}
          >
            <ReplyIcon />
            {replyLabel}
          </Button>
        )}
        {target.viewerReacted ? (
          <span role="status" title="You gave it a thumbs up on GitHub" className="flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent">
            <ThumbsUpIcon />
            You: thumbs up
          </span>
        ) : (
          <Button
            variant="quiet"
            className={target.canReply ? '' : '-ml-2.5'}
            disabled={reactBlocked !== null || actions.isBusy(`react:${props.prKey}:${target.commentId}`)}
            title={reactBlocked ?? `Adds a 👍 reaction on GitHub: tells ${target.author} you saw it, nothing to add`}
            onClick={() => void actions.react(props.prKey, target.commentId)}
          >
            <ThumbsUpIcon />
            Thumbs up
          </Button>
        )}
      </span>
      {replyOpen && (
        <Composer
          target={{ kind: 'reply', commentId: target.commentId }}
          title={copy.title}
          hint={copy.hint}
          submit={copy.submit}
          variant="primary"
          write="reply"
          submitTitle={target.inThread ? 'Posts the reply in this thread on GitHub' : 'Posts a PR comment that quotes this one'}
          sending={actions.isBusy(`replySend:${props.prKey}:${target.commentId}`)}
          drafting={actions.isBusy(`reply:${props.prKey}:${target.commentId}`)}
          draft={(gist) => actions.draftReply(props.prKey, target.commentId, gist)}
          send={(body) => actions.replyToComment(props.prKey, target.commentId, body)}
        />
      )}
    </div>
  );
}

/** How long a line stays tinted after "Reply ↓" scrolled to it. */
const FLASH_MS = 1600;

/**
 * One line of the activity list. A person's comment gets Reply and React;
 * when "Reply ↓" in "New since" jumps to it, the line scrolls to the middle
 * of the pane and is tinted for a moment.
 */
function TalkLine(props: { line: ActivityLine; last: boolean; pr: Pr; viewerLogin: string | null }) {
  const compose = useCompose();
  const root = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const target = replyTargetOf(props.line, props.pr, props.viewerLogin);
  const jumpSeq = target && compose.jump?.commentId === target.commentId ? compose.jump.seq : null;
  useEffect(() => {
    if (jumpSeq === null) {
      return;
    }
    root.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [jumpSeq]);
  const below = target ? <TalkActions prKey={props.pr.key} target={target} /> : null;
  return (
    <div ref={root} className={`-mx-2 rounded-row px-2 transition-colors duration-700 motion-reduce:transition-none ${flash ? 'bg-accent-soft' : ''}`}>
      {lineRow(props.line, props.last, below)}
    </div>
  );
}

/**
 * The PR's activity from core (`PrDetail.activity`), newest first: what is
 * new since you looked first, then the rest. "New since you looked" under
 * the title is the digest; replies happen here, on the comment, with the
 * thread around it. About a dozen lines before "Show all N"; a jump to a
 * line further down opens the rest. Bot and CI noise is one line that
 * expands.
 */
export function ActivityTimeline(props: { activity: ActivityList; pr: Pr; viewerLogin: string | null }) {
  const compose = useCompose();
  const [showAll, setShowAll] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const { fresh, earlier, noise } = props.activity;
  const lines = [...fresh, ...earlier];
  const jumpIndex = compose.jump ? lines.findIndex((line) => replyTargetOf(line, props.pr, props.viewerLogin)?.commentId === compose.jump?.commentId) : -1;
  const jumpSeq = compose.jump?.seq ?? null;
  const jumpFolded = jumpIndex >= props.activity.cap;
  // A jump to a folded line opens the list once; the line then scrolls itself into view. "Show fewer" still folds it after.
  useEffect(() => {
    if (jumpFolded) {
      setShowAll(true);
    }
  }, [jumpSeq, jumpFolded]);
  const shown = showAll ? lines : lines.slice(0, props.activity.cap);
  const { threadChangedAt } = props.activity;
  const empty = lines.length === 0 && noise.length === 0 && threadChangedAt === null;
  return (
    <div className="flex flex-col px-3">
      <span className="pb-2">
        <SectionLabel>Activity</SectionLabel>
      </span>
      {empty && <span className="text-xs text-hint">No activity yet.</span>}
      {threadChangedAt !== null && <ThreadChangeRow at={threadChangedAt} last={lines.length === 0 && noise.length === 0} />}
      {shown.map((line, index) => (
        <TalkLine key={line.id} line={line} last={index === shown.length - 1} pr={props.pr} viewerLogin={props.viewerLogin} />
      ))}
      {lines.length > props.activity.cap && (
        <button type="button" className={linkButton} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${lines.length}`}
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
