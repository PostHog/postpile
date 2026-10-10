import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PaneOffers, PrDetail, PrIcon, PrStatus, PrSummary, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useViewer } from '../api/viewer.ts';
import { assigneeLine } from '../lib/assignees.ts';
import { updatingNow } from '../lib/staleness.ts';
import { sinceLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { AssignedTo } from './AssignedTo.tsx';
import { Avatar } from './Avatar.tsx';
import { AgentFacts } from './AgentFacts.tsx';
import { AgentNoteLines } from './AgentNoteLines.tsx';
import { GlanceCard } from './GlanceCard.tsx';
import { NewSinceBox } from './NewSinceBox.tsx';
import { ICON_WORDS, mergeQueueWord, reviewWord, stackQueueWord, type StateWord } from '../lib/pr.ts';
import { type StackPlace, stackPlaces } from '../lib/stacks.ts';
import { Button } from './Button.tsx';
import { ComposeProvider, useComposeState } from './Composer.tsx';
import { BranchArrowIcon, PrStateIcon } from './icons.tsx';
import { OpenOnGitHub } from './OpenOnGitHub.tsx';
import { PaneHousekeeping } from './PaneHousekeeping.tsx';
import { ReviewRow } from './ReviewRow.tsx';
import { StackMark, StateWordLabel } from './pills.tsx';
import { PrDescription } from './PrDescription.tsx';
import { PrFacts } from './PrFacts.tsx';
import { ReviewList } from './ReviewList.tsx';

interface PrBodyProps {
  detail: PrDetail;
  summary: PrSummary | null;
  view: TileView;
  /** Core's offers for this PR (`paneOffersFor`): which writes show and what leads. */
  offers: PaneOffers;
}

/** "head → base", plus the layer for a stack layer, also inside a set (bottom layer is 1). */
function BranchLine(props: { pr: PrDetail['pr']; place: StackPlace | null }) {
  const { pr, place } = props;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] leading-[normal] text-hint select-text">
      <span className="min-w-0 truncate">{pr.headRef}</span>
      <BranchArrowIcon className="shrink-0 text-ghost" />
      <span className="min-w-0 truncate">{pr.baseRef}</span>
      {place && (
        <span className="whitespace-nowrap">
          <span className="text-ghost">·</span> layer {place.layer} of {place.of}
        </span>
      )}
    </span>
  );
}

/** "acme/app#1907": the repo faint, the number a notch darker. */
function RepoRef(props: { prKey: string }) {
  const [repo, number] = props.prKey.split('#');
  return (
    <span className="min-w-0 truncate font-mono text-[11px] text-faint select-text">
      {repo}
      {number !== undefined && <span className="text-hint">#{number}</span>}
    </span>
  );
}

const ICON_TEXT_TONES: Record<PrIcon, string> = {
  open: 'text-open',
  draft: 'text-muted',
  merge_queue: 'text-pending-ink',
  merge_queue_failed: 'text-status-bad',
  merged: 'text-merged-ink',
  closed: 'text-status-bad',
};

/**
 * The state line: big state icon and its word, the review state as icon +
 * word, the PR key, and the GitHub link. A PR in the merge queue says where
 * it stands there instead of the review ("Merge queue: Testing"), and since
 * when; the reason of a failure gets its own line (`QueueFailure`). No CI
 * (only in the facts). "Open on GitHub" lives here, next to the PR's
 * identity, and nowhere else in the pane.
 */
function StateLine(props: { pr: PrBodyProps['detail']['pr']; status: PrStatus; stackQueue: StateWord | null; openLeads: boolean }) {
  const { pr, status } = props;
  const now = useNow();
  const queue = mergeQueueWord(status, now);
  const words = queue ?? ICON_WORDS[status.icon];
  // A higher layer's queue says so in place of the review, like on the PR's row.
  const review = queue ? null : (props.stackQueue ?? reviewWord(status));
  return (
    <div className="flex items-center gap-2.5">
      <span title={words.title} className={`flex shrink-0 items-center gap-2 text-[12.5px] font-semibold ${ICON_TEXT_TONES[status.icon]}`}>
        <PrStateIcon state={status.icon} title={words.title} size={14} className="mx-[3px]" />
        <span>{words.text}</span>
      </span>
      {status.mergeQueue && <span className="shrink-0 text-[11px] text-hint">since {sinceLabel(status.mergeQueue.since, now)}</span>}
      {review && <StateWordLabel word={review} size="md" />}
      <RepoRef prKey={pr.key} />
      {/* The line's text starts at 34px, but the button ends on the boxes' right edge, 12px further out. */}
      <span className="-mr-3 ml-auto">
        <OpenOnGitHub url={pr.url} leads={props.openLeads} />
      </span>
    </div>
  );
}

/** Under the branch line of a PR the merge queue took out: "Failed (tests failed)", in red, the full story in the tooltip. */
function QueueFailure(props: { status: PrStatus }) {
  const now = useNow();
  const word = mergeQueueWord(props.status, now);
  if (word?.kind !== 'merge_queue_failed') {
    return null;
  }
  const reason = props.status.mergeQueue?.reason;
  return (
    <span title={word.title} className="truncate text-[11px] font-medium text-status-bad">
      {reason ? `Failed (${reason})` : 'Failed'}
    </span>
  );
}

/**
 * "Back to top" while the review row has scrolled out above: after a jump
 * down to a comment, the way back to the verdict is one click.
 */
function useBelowRow(scroller: RefObject<HTMLDivElement | null>, row: RefObject<HTMLDivElement | null>): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    function onScroll() {
      const anchor = row.current;
      if (anchor) {
        setBelow(anchor.getBoundingClientRect().bottom < element!.getBoundingClientRect().top);
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [scroller, row]);
  return below;
}

/**
 * The scrolling part of the detail pane for one PR, top down: state line
 * (with Open on GitHub), title, "New since you looked" (a digest; its
 * "Reply ↓" jumps to the comment), the agent's glance (advice, on its own),
 * the review row (its own row right after the glance: the shortest pointer
 * path from the tile) with the quiet housekeeping line under it (mark read,
 * snooze, ⋯), then description, facts and the activity, where
 * every person's comment takes Reply and React. One composer is open at a
 * time; its state lives here, so it starts fresh per PR.
 */
export function PrBody(props: PrBodyProps) {
  const { syncing } = useActions();
  const { pr } = props.detail;
  const { offers } = props;
  const compose = useComposeState();
  const scroller = useRef<HTMLDivElement>(null);
  const reviewRow = useRef<HTMLDivElement>(null);
  const belowRow = useBelowRow(scroller, reviewRow);
  const place = stackPlaces(props.view.tile.stacks).get(pr.key) ?? null;
  const viewerLogin = useViewer().data?.login ?? null;
  const assigned = assigneeLine(pr.author, pr.assignees ?? [], viewerLogin);
  // A whole-topic catch-up rewrites the facts; a glance-only refresh on look does not (server decides).
  const updating = updatingNow({ syncing, writing: props.detail.memoryUpdating });
  const row = props.view.prs.find((candidate) => candidate.key === pr.key);
  // The PR's owner: its author, or the person a bot opened it for.
  const askPerson = row?.facts.owners[0] ?? pr.author;
  return (
    <ComposeProvider value={compose}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* 22px pane edge: boxes and rows run from here; lines of text start 12px in (px-3), at 34. */}
        <div ref={scroller} className="pane-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-auto pl-[22px] pr-[12px] pt-[18px] pb-6">
          <div className="flex flex-col gap-[5px] px-3">
            <StateLine
              pr={pr}
              status={props.detail.status}
              stackQueue={stackQueueWord(pr.key, props.view.prs, props.view.tile.stacks, new Date())}
              openLeads={offers.lead === 'open_on_github'}
            />
            <div className="flex items-start gap-2">
              {/* The mark sits on the title's first line: 18px tag, nudged to its center. */}
              {place && (
                <span className="mt-px">
                  <StackMark place={place} />
                </span>
              )}
              <h2 className="min-w-0 text-[16px] leading-[1.3] [overflow-wrap:anywhere] font-[650] tracking-[-0.016em] text-balance select-text">{pr.title}</h2>
            </div>
            <BranchLine pr={pr} place={place} />
            <QueueFailure status={props.detail.status} />
            {assigned && (
              // Only when someone other than the author is assigned: whose agent PR it is.
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-hint">
                opened by
                <Avatar login={pr.author} />
                <span className="truncate">{pr.author}</span>
                <span className="text-faint">·</span>
                <AssignedTo line={assigned} />
              </span>
            )}
            <AgentNoteLines notes={props.detail.notes} />
          </div>
          <NewSinceBox detail={props.detail} />
          <GlanceCard detail={props.detail} summary={props.summary} view={props.view} />
          <div ref={reviewRow} className="flex flex-col gap-2.5">
            {(offers.approve || offers.ask) && <ReviewRow detail={props.detail} offers={offers} askPerson={askPerson} />}
            <PaneHousekeeping view={props.view} prKey={pr.key} offers={offers} />
          </div>
          <PrDescription body={pr.body} />
          <PrFacts pr={pr} agentApprovers={props.detail.agentApprovers} />
          <ReviewList pr={pr} />
          <AgentFacts facts={props.detail.facts} updating={updating} />
          <ActivityTimeline activity={props.detail.activity} prKey={pr.key} />
        </div>
        {belowRow && (
          <Button
            className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-menu"
            title="Back to the top of the PR, where the review row is"
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            ↑ Back to top
          </Button>
        )}
      </div>
    </ComposeProvider>
  );
}
