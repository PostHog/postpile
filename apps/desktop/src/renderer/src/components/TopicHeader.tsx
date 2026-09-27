import { useState } from 'react';
import type { DossierStatus, DossierView, TopicDetail, TopicGroup, TopicListItem, TopicProposal, UserRole } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { statusLabel } from '../lib/memory.ts';
import { lineTarget } from '../lib/sources.ts';
import { proposalText } from '../lib/proposals.ts';
import { countPrs } from '../lib/tiles.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { DossierPanel } from './DossierPanel.tsx';
import { ChevronIcon, QuoteIcon } from './icons.tsx';
import { MemoryLine } from './MemoryLine.tsx';
import { SinceLastLooked } from './SinceLastLooked.tsx';

const ROLE_LABELS: Record<UserRole, string> = {
  driver: 'You drive',
  reviewer: 'You review',
  stakeholder: 'You have a stake',
  watcher: 'You watch',
};

const STATUS_TONES: Record<DossierStatus, string> = {
  starting: 'bg-accent-soft text-accent',
  active: 'bg-safe-soft text-safe',
  blocked: 'bg-unread-soft text-unread-ink',
  winding_down: 'bg-closer-soft text-closer',
  finished: 'bg-segment text-muted',
};

const chip = 'flex h-[22px] items-center rounded-full border border-hairline bg-surface text-[11.5px] text-ink-2';

function ProposalRow(props: { proposal: TopicProposal; topics: TopicListItem[] }) {
  const actions = useActions();
  const { proposal } = props;
  const topicName = (topicId: string) => props.topics.find((item) => item.topic.id === topicId)?.topic.name ?? topicId;
  return (
    <div className="flex max-w-[680px] items-center gap-3 rounded-row border border-accent-line bg-accent-soft px-3 py-2 text-xs">
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Agent proposes: {proposalText(proposal, topicName)}.</span>{' '}
        <span className="text-ink-2">{proposal.reason}</span>
      </span>
      <Button onClick={() => void actions.decideProposal(proposal.id, true)}>Accept</Button>
      <Button onClick={() => void actions.decideProposal(proposal.id, false)}>Reject</Button>
    </div>
  );
}

/** Status, goal and people from the dossier, the "since you last looked" block, and the full dossier on demand. */
function DossierSummary(props: { dossier: DossierView; topicId: string }) {
  const [open, setOpen] = useState(false);
  const { dossier: view, topicId } = props;
  const { dossier } = view;
  const statusText = dossier.statusNote ? `${statusLabel(dossier.status)}: ${dossier.statusNote}` : statusLabel(dossier.status);
  return (
    <>
      <div className="flex max-w-[680px] flex-col gap-1">
        <MemoryLine
          correction={{ kind: 'wrong', factId: null, topicId, text: statusText }}
          stale={null}
          corrected={view.correctedClaims.includes(statusText)}
          why={lineTarget(topicId, view, 'status')}
        >
          <span className={`mr-2 inline-flex h-[19px] items-center rounded-full px-2 text-[10.5px] font-semibold ${STATUS_TONES[dossier.status]}`}>
            {statusLabel(dossier.status)}
          </span>
          {dossier.statusNote}
        </MemoryLine>
        {dossier.goal && (
          <MemoryLine
            correction={{ kind: 'wrong', factId: null, topicId, text: dossier.goal }}
            stale={null}
            corrected={view.correctedClaims.includes(dossier.goal)}
            why={lineTarget(topicId, view, 'goal')}
          >
            <span className="text-muted">Goal:</span> {dossier.goal}
          </MemoryLine>
        )}
      </div>
      <SinceLastLooked dossier={view} topicId={topicId} />
      <div className="flex max-w-[680px] flex-wrap items-center gap-1.5">
        {dossier.people.map((person) => (
          <span key={person.login} className={`${chip} gap-1.5 pr-2 pl-[3px]`} title={person.note}>
            <Avatar login={person.login} size="sm" />
            {person.login}
            <span className="text-faint">{person.role}</span>
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ml-auto flex h-[22px] items-center gap-1 rounded-control px-2 text-[11.5px] text-accent hover:bg-accent-soft"
        >
          Dossier <span className="font-mono text-[10.5px] text-muted">v{view.version}</span>
          <span className={open ? 'rotate-180' : ''}>
            <ChevronIcon />
          </span>
        </button>
      </div>
      {open && <DossierPanel dossier={view} topicId={topicId} />}
    </>
  );
}

/** Breadcrumb, name, who drives, the dossier (or the plain summary before one exists) and what the user told the agent. */
export function TopicHeader(props: { detail: TopicDetail; group: TopicGroup; topics: TopicListItem[] }) {
  const { topic, tiles, pendingProposals, dossier } = props.detail;
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
      {dossier && <DossierSummary dossier={dossier} topicId={topic.id} />}
      {topic.tailoring && (
        <div className="flex max-w-[680px] items-start gap-2 text-xs leading-normal text-muted">
          <span className="text-faint">
            <QuoteIcon />
          </span>
          <span>You told the agent: {topic.tailoring}</span>
        </div>
      )}
      {pendingProposals.map((proposal) => (
        <ProposalRow key={proposal.id} proposal={proposal} topics={props.topics} />
      ))}
    </div>
  );
}
