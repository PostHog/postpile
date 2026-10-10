import type { ReactNode } from 'react';
import type { PendingProposals, RuleProposal, TopicListItem, TopicProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { proposalMeta, proposalText } from '../lib/proposals.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';

function Card(props: { title: string; meta: string; reason: string; onDecide: (accept: boolean) => void; busy: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-tile bg-surface p-3.5 shadow-tile">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-semibold select-text">{props.title}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-faint">{props.meta}</span>
      </div>
      {props.children}
      <p className="text-xs leading-normal text-ink-2 select-text">{props.reason}</p>
      <div className="flex gap-2">
        <Button variant="primary" disabled={props.busy} onClick={() => props.onDecide(true)}>
          Accept
        </Button>
        <Button disabled={props.busy} onClick={() => props.onDecide(false)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function TopicProposalCard(props: { proposal: TopicProposal; topicName: (topicId: string) => string }) {
  const actions = useActions();
  const now = useNow();
  const { proposal } = props;
  return (
    <Card
      title={`${proposalText(proposal, props.topicName)}?`}
      meta={proposalMeta(proposal, ageLabel(proposal.createdAt, now))}
      reason={proposal.reason}
      busy={actions.isBusy(`proposal:${proposal.id}`)}
      onDecide={(accept) => void actions.decideProposal(proposal.id, accept)}
    />
  );
}

function RuleProposalCard(props: { proposal: RuleProposal; topicName: (topicId: string) => string }) {
  const actions = useActions();
  const now = useNow();
  const { proposal } = props;
  const scope = proposal.topicId ? `Added to the tailoring of "${props.topicName(proposal.topicId)}"` : 'Applies to every topic';
  const evidence = proposal.evidenceFeedbackIds.length;
  return (
    <Card
      title="New standing rule?"
      meta={`rule · ${ageLabel(proposal.createdAt, now)}`}
      reason={evidence > 0 ? `${proposal.reason} Based on ${evidence} corrections.` : proposal.reason}
      busy={actions.isBusy(`rule:${proposal.id}`)}
      onDecide={(accept) => void actions.decideRuleProposal(proposal.id, accept)}
    >
      <p className="rounded-row bg-subtle px-3 py-2 text-[12.5px] leading-normal text-ink select-text">“{proposal.text}”</p>
      <span className="text-[11.5px] text-muted">{scope}</span>
    </Card>
  );
}

/** Middle pane when "Inbox" is picked: what consolidation proposes, nothing applied until accepted. */
export function InboxPane(props: { proposals: PendingProposals | undefined; topics: TopicListItem[]; error: string | null }) {
  const topicName = (topicId: string) => props.topics.find((item) => item.topic.id === topicId)?.topic.name ?? topicId;
  const topics = props.proposals?.topics ?? [];
  const rules = props.proposals?.rules ?? [];
  return (
    <main className="pane-scroll flex min-w-0 flex-col gap-[18px] overflow-auto pl-[26px] pr-[16px] py-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">Inbox</h1>
        <p className="max-w-[680px] text-[13px] text-ink-2">The agent proposes topic changes and standing rules. Nothing changes until you accept.</p>
      </div>
      {props.error && <p className="text-xs text-status-bad">Could not load proposals: {props.error}</p>}
      {!props.error && props.proposals && topics.length === 0 && rules.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">Nothing waiting for you.</p>
      )}
      <div className="flex max-w-[680px] flex-col gap-3">
        {topics.map((proposal) => (
          <TopicProposalCard key={proposal.id} proposal={proposal} topicName={topicName} />
        ))}
        {rules.map((proposal) => (
          <RuleProposalCard key={proposal.id} proposal={proposal} topicName={topicName} />
        ))}
      </div>
    </main>
  );
}
