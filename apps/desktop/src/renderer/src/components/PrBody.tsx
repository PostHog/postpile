import type { ReactNode } from 'react';
import type { PrDetail, PrLifecycle, PrStatus, PrSummary, TileView } from '@postpile/core';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { AgentFacts } from './AgentFacts.tsx';
import { GlanceCard } from './GlanceCard.tsx';
import { LIFECYCLE_WORDS, reviewWord } from '../lib/pr.ts';
import { ExternalIcon, PrStateIcon } from './icons.tsx';
import { StateWordLabel } from './pills.tsx';
import { PrFacts } from './PrFacts.tsx';
import { ReviewList } from './ReviewList.tsx';

interface PrBodyProps {
  detail: PrDetail;
  summary: PrSummary | null;
  view: TileView;
  /** The action bar (and the ask composer), right under the assessment. */
  actions: ReactNode;
}

/** "head → base", plus the layer for stacks (bottom layer is 1). */
function branchLine(props: PrBodyProps): string {
  const { pr } = props.detail;
  const line = `${pr.headRef} → ${pr.baseRef}`;
  if (props.view.tile.kind !== 'stack') {
    return line;
  }
  const layer = props.view.prs.findIndex((candidate) => candidate.key === pr.key) + 1;
  return `${line} · layer ${layer} of ${props.view.prs.length}`;
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
  const { pr } = props.detail;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-[22px] py-[18px]">
      <StateLine pr={pr} status={props.summary?.status ?? null} />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg leading-tight font-[650] tracking-[-0.018em] select-text">{pr.title}</h2>
        <span className="font-mono text-[11px] text-muted select-text">{branchLine(props)}</span>
      </div>
      <GlanceCard detail={props.detail} summary={props.summary} view={props.view} />
      {props.actions}
      <PrFacts pr={pr} agentApprovers={props.detail.agentApprovers} />
      <ReviewList pr={pr} />
      <AgentFacts facts={props.detail.facts} />
      <ActivityTimeline activity={props.detail.activity} />
    </div>
  );
}
