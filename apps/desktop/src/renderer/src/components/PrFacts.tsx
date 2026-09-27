import type { ReactNode } from 'react';
import type { Pr } from '@code-manager/core';
import { checkCounts, lastPushAt, mergeStatus } from '../lib/pr.ts';
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
export function PrFacts(props: { pr: Pr }) {
  const now = useNow();
  const { pr } = props;
  const checks = checkCounts(pr.checks);
  const pushedAt = lastPushAt(pr);
  const age = pr.mergedAt ? `merged ${ageLabel(pr.mergedAt, now)}` : `opened ${ageLabel(pr.createdAt, now)}`;
  const checksNote = checks.failed > 0 ? `${checks.failed} failed` : checks.pending > 0 ? `${checks.pending} running` : 'green';
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      <Fact label="Size">
        <span className="font-mono text-xs">
          <span className="text-open">+{pr.additions}</span> <span className="text-closed">−{pr.deletions}</span>{' '}
          <span className="text-faint">· {pr.changedFiles} files</span>
        </span>
        <SplitBar
          parts={[
            { weight: pr.additions, tone: 'bg-open' },
            { weight: pr.deletions, tone: 'bg-unread' },
          ]}
        />
      </Fact>
      <Fact label="Checks">
        {checks.total === 0 ? (
          <span className="font-mono text-xs text-faint">none</span>
        ) : (
          <span className="font-mono text-xs">
            {checks.ok}
            <span className="text-faint">/{checks.total}</span> <span className="text-faint">· {checksNote}</span>
          </span>
        )}
        <SplitBar
          parts={[
            { weight: checks.ok, tone: 'bg-open' },
            { weight: checks.pending, tone: 'bg-pending' },
            { weight: checks.failed, tone: 'bg-unread' },
          ]}
        />
      </Fact>
      <Fact label="Age">
        <span className="font-mono text-xs">
          {age}
          {pushedAt && !pr.mergedAt && <span className="text-faint"> · pushed {ageLabel(pushedAt, now)}</span>}
        </span>
      </Fact>
      <Fact label="To merge">
        <span className="text-[12.5px]">{mergeStatus(pr)}</span>
      </Fact>
    </div>
  );
}
