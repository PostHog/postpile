import type { ReactNode } from 'react';
import type { PrDetail, PrLifecycle, PrStatus, PrSummary, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { updatingNow } from '../lib/staleness.ts';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { AgentFacts } from './AgentFacts.tsx';
import { GlanceCard } from './GlanceCard.tsx';
import { NewSinceBox } from './NewSinceBox.tsx';
import { LIFECYCLE_WORDS, reviewWord } from '../lib/pr.ts';
import { type StackPlace, stackPlaces } from '../lib/stacks.ts';
import { ExternalIcon, PrStateIcon } from './icons.tsx';
import { StackMark, StateWordLabel } from './pills.tsx';
import { PrDescription } from './PrDescription.tsx';
import { PrFacts } from './PrFacts.tsx';
import { ReviewList } from './ReviewList.tsx';

interface PrBodyProps {
  detail: PrDetail;
  summary: PrSummary | null;
  view: TileView;
  /** The action bar (and the ask composer), right under the assessment. */
  actions: ReactNode;
}

/** "head → base", plus the layer for a stack layer, also inside a set (bottom layer is 1). */
function branchLine(props: PrBodyProps, place: StackPlace | null): string {
  const { pr } = props.detail;
  const line = `${pr.headRef} → ${pr.baseRef}`;
  if (!place) {
    return line;
  }
  return `${line} · layer ${place.layer} of ${place.of}`;
}

const LIFECYCLE_TEXT_TONES: Record<PrLifecycle, string> = {
  open: 'text-open',
  draft: 'text-muted',
  queued: 'text-status-queued',
  merged: 'text-merged-ink',
  closed: 'text-status-bad',
};

/**
 * The state line: big state icon and lifecycle word, the review state as
 * icon + word, the PR key, and the GitHub link. No CI (only in the facts).
 */
function StateLine(props: { pr: PrBodyProps['detail']['pr']; status: PrStatus | null }) {
  const { pr, status } = props;
  const lifecycle: PrLifecycle = status?.lifecycle ?? (pr.isDraft ? 'draft' : 'open');
  const words = LIFECYCLE_WORDS[lifecycle];
  const review = status ? reviewWord(status) : null;
  return (
    <div className="flex items-center gap-3.5">
      <span title={words.title} className={`flex items-center gap-1.5 text-[13px] font-semibold ${LIFECYCLE_TEXT_TONES[lifecycle]}`}>
        <PrStateIcon lifecycle={lifecycle} title={words.title} size={16} />
        {words.text}
      </span>
      {review && <StateWordLabel word={review} size="md" />}
      <span className="min-w-0 truncate font-mono text-[11.5px] text-muted select-text">{pr.key}</span>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open on GitHub"
        title="Open on GitHub"
        className="ml-auto flex size-[30px] shrink-0 items-center justify-center rounded-control border border-control text-ink-2 shadow-control hover:bg-subtle"
      >
        <ExternalIcon />
      </a>
    </div>
  );
}

/** The scrolling part of the detail pane for one PR. */
export function PrBody(props: PrBodyProps) {
  const { syncing } = useActions();
  const { pr } = props.detail;
  const place = stackPlaces(props.view.tile.stacks).get(pr.key) ?? null;
  // A catch-up run on the PR's topic shows as its glance writing; facts get rewritten by it too.
  const updating = updatingNow({ syncing, writing: props.detail.glanceState === 'writing' });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-[22px] py-[18px]">
      <StateLine pr={pr} status={props.summary?.status ?? null} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          {/* The mark sits on the title's first line: 18px tag, nudged to its center. */}
          {place && (
            <span className="mt-[2px]">
              <StackMark place={place} />
            </span>
          )}
          <h2 className="min-w-0 text-lg leading-tight font-[650] tracking-[-0.018em] select-text">{pr.title}</h2>
        </div>
        <span className="font-mono text-[11px] text-muted select-text">{branchLine(props, place)}</span>
      </div>
      <NewSinceBox key={pr.key} detail={props.detail} />
      <GlanceCard detail={props.detail} summary={props.summary} view={props.view} />
      {props.actions}
      <PrDescription key={pr.key} body={pr.body} />
      <PrFacts pr={pr} agentApprovers={props.detail.agentApprovers} />
      <ReviewList pr={pr} />
      <AgentFacts facts={props.detail.facts} updating={updating} />
      <ActivityTimeline activity={props.detail.activity} />
    </div>
  );
}
