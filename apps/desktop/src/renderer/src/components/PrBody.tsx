import type { PrDetail, PrSummary, TileView } from '@postpile/core';
import { ActivityTimeline } from './ActivityTimeline.tsx';
import { AgentFacts } from './AgentFacts.tsx';
import { GlanceCard } from './GlanceCard.tsx';
import { ExternalIcon } from './icons.tsx';
import { StatusPill } from './pills.tsx';
import { PrFacts } from './PrFacts.tsx';
import { ReviewList } from './ReviewList.tsx';

interface PrBodyProps {
  detail: PrDetail;
  summary: PrSummary | null;
  view: TileView;
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

/** The scrolling part of the detail pane for one PR. */
export function PrBody(props: PrBodyProps) {
  const { pr } = props.detail;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-[22px] py-[18px]">
      <div className="flex items-center gap-2">
        {props.summary && <StatusPill status={props.summary.status} size="md" />}
        <span className="font-mono text-[11px] text-muted select-text">{pr.key}</span>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on GitHub"
          title="Open on GitHub"
          className="ml-auto flex size-[26px] items-center justify-center rounded-md border border-hairline text-ink-2 hover:bg-subtle"
        >
          <ExternalIcon />
        </a>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg leading-tight font-[650] tracking-[-0.018em] select-text">{pr.title}</h2>
        <span className="font-mono text-[11px] text-muted select-text">{branchLine(props)}</span>
      </div>
      <GlanceCard detail={props.detail} summary={props.summary} view={props.view} />
      <PrFacts pr={pr} />
      <ReviewList pr={pr} />
      <AgentFacts facts={props.detail.facts} />
      <ActivityTimeline activity={props.detail.activity} />
    </div>
  );
}
