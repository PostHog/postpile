import type { TopicDetail, TopicGroup, TopicProposal, UserRole } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { countPrs } from '../lib/tiles.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { QuoteIcon } from './icons.tsx';

const ROLE_LABELS: Record<UserRole, string> = {
  driver: 'You drive',
  reviewer: 'You review',
  stakeholder: 'You have a stake',
  watcher: 'You watch',
};

const chip = 'flex h-[22px] items-center rounded-full border border-hairline bg-surface text-[11.5px] text-ink-2';

function proposalText(proposal: TopicProposal): string {
  if (proposal.kind === 'rename') {
    return `Rename to "${proposal.name ?? ''}"`;
  }
  if (proposal.kind === 'merge') {
    return 'Merge into another topic';
  }
  return `New topic "${proposal.name ?? ''}"`;
}

function ProposalRow(props: { proposal: TopicProposal }) {
  const actions = useActions();
  const { proposal } = props;
  return (
    <div className="flex max-w-[680px] items-center gap-3 rounded-row border border-accent-line bg-accent-soft px-3 py-2 text-xs">
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Agent proposes: {proposalText(proposal)}.</span>{' '}
        <span className="text-ink-2">{proposal.reason}</span>
      </span>
      <Button onClick={() => void actions.decideProposal(proposal.id, true)}>Accept</Button>
      <Button onClick={() => void actions.decideProposal(proposal.id, false)}>Reject</Button>
    </div>
  );
}

/** Breadcrumb, name, who drives, the agent summary and what the user told the agent. */
export function TopicHeader(props: { detail: TopicDetail; group: TopicGroup }) {
  const { topic, tiles, pendingProposals } = props.detail;
  const counts = countPrs(tiles);
  const prCount = counts.pinged + counts.pulledIn;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <span>Topics</span>
        <span>›</span>
        <span className="text-muted">{props.group === 'needs_you' ? 'Needs you' : 'Quiet'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">{topic.name}</h1>
        <span className="flex gap-1.5">
          {topic.driver && topic.userRole !== 'driver' && (
            <span className={`${chip} gap-1.5 pr-2 pl-[3px]`}>
              <Avatar login={topic.driver} size="sm" />
              {topic.driver} drives
            </span>
          )}
          <span className={`${chip} px-2`}>{ROLE_LABELS[topic.userRole]}</span>
          <span className={`${chip} px-2 font-mono text-[10.5px] text-muted`}>
            {prCount} {prCount === 1 ? 'PR' : 'PRs'}
          </span>
        </span>
      </div>
      {topic.summary && <p className="max-w-[680px] text-[13.5px] leading-normal text-pretty text-ink-2">{topic.summary}</p>}
      {topic.tailoring && (
        <div className="flex max-w-[680px] items-start gap-2 text-xs leading-normal text-muted">
          <span className="text-faint">
            <QuoteIcon />
          </span>
          <span>You told the agent: {topic.tailoring}</span>
        </div>
      )}
      {pendingProposals.map((proposal) => (
        <ProposalRow key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}
