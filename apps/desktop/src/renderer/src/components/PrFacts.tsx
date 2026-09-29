import type { ReactNode } from 'react';
import type { Pr } from '@postpile/core';
import { checkCounts, checksNote, lastPushAt, mergeStatus } from '../lib/pr.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';

/** A thin bar split by weights. Widths depend on data, so they are inline flex values. */
function SplitBar(props: { parts: { weight: number; tone: string }[] }) {
  const visible = props.parts.filter((part) => part.weight > 0);
  if (visible.length === 0) {
    return <span className="h-1 rounded-sm bg-segment" />;
  }
  return (
    <span className="flex gap-0.5">
      {visible.map((part) => (
        <span key={part.tone} className={`h-1 rounded-sm ${part.tone}`} style={{ flex: part.weight }} />
      ))}
    </span>
  );
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Size, checks, age and what stands between the PR and a merge. */
/** `agentApprovers` (`PrDetail.agentApprovers`) lets "To merge" say "approved by reviewbot (agent)". */
export function PrFacts(props: { pr: Pr; agentApprovers: string[] }) {
  const now = useNow();
  const { pr } = props;
  const checks = checkCounts(pr.checks);
  const pushedAt = lastPushAt(pr);
  const age = pr.mergedAt ? `merged ${ageLabel(pr.mergedAt, now)}` : `opened ${ageLabel(pr.createdAt, now)}`;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      <Fact label="Size">
        <span className="font-mono text-xs">
          <span className="text-open">+{pr.additions}</span> <span className="text-diff-red">−{pr.deletions}</span>{' '}
          <span className="text-hint">· {pr.changedFiles} files</span>
        </span>
        <SplitBar
          parts={[
            { weight: pr.additions, tone: 'bg-open' },
            { weight: pr.deletions, tone: 'bg-diff-red' },
          ]}
        />
      </Fact>
      {/* Neutral on purpose: CI is not a signal in PostPile, so no pass or fail colour (2026-09-29). */}
      <Fact label="Checks">
        <span className="font-mono text-xs text-muted">{checks.total === 0 ? 'none' : checksNote(checks)}</span>
        <SplitBar
          parts={[
            { weight: checks.ok, tone: 'bg-dot-quiet' },
            { weight: checks.failed + checks.pending, tone: 'bg-chip' },
          ]}
        />
      </Fact>
      <Fact label="Age">
        <span className="font-mono text-xs">
          {age}
          {pushedAt && !pr.mergedAt && <span className="text-hint"> · pushed {ageLabel(pushedAt, now)}</span>}
        </span>
      </Fact>
      <Fact label="To merge">
        <span className="text-[12.5px]">{mergeStatus(pr, props.agentApprovers)}</span>
      </Fact>
    </div>
  );
}
