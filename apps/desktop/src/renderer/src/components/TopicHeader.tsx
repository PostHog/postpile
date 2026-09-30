import { useState } from 'react';
import type { DossierStatus, DossierView, TopicDetail, TopicGroup, TopicListItem, TopicProposal, UserRole } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { fixedText, statusLabel } from '../lib/memory.ts';
import { lineTarget } from '../lib/sources.ts';
import { updatingNow } from '../lib/staleness.ts';
import { proposalText, suggestedBy } from '../lib/proposals.ts';
import { countPrs } from '../lib/tiles.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { DossierPanel } from './DossierPanel.tsx';
import { ChevronIcon, QuoteIcon } from './icons.tsx';
import { MemoryLine } from './MemoryLine.tsx';
import { RelationLine } from './RelationLine.tsx';
import { SinceLastLooked } from './SinceLastLooked.tsx';

/** Your role in the topic as a noun (2026-09-29): "You review" read like an order next to "lyra drives". */
const ROLE_LABELS: Record<UserRole, string> = {
  driver: 'Driver',
  reviewer: 'Reviewer',
  stakeholder: 'Stakeholder',
  watcher: 'Watcher',
};

const STATUS_TONES: Record<DossierStatus, { pill: string; dot: string }> = {
  starting: { pill: 'bg-accent-soft text-accent', dot: 'bg-accent ring-accent/18' },
  active: { pill: 'bg-safe-soft text-safe', dot: 'bg-open ring-open/18' },
  blocked: { pill: 'bg-unread-soft text-unread-ink', dot: 'bg-unread-ink ring-unread-ink/18' },
  winding_down: { pill: 'bg-closer-soft text-closer', dot: 'bg-closer ring-closer/18' },
  finished: { pill: 'bg-segment text-muted', dot: 'bg-dot-quiet ring-dot-quiet/18' },
};

/** The quiet pills next to the topic name. */
const pill = 'flex h-5 items-center gap-[5px] rounded-full bg-pill-quiet text-[11px] whitespace-nowrap text-ink-2';
/** White people chips under the timeline. */
const personChip = 'flex h-[22px] items-center gap-1.5 rounded-full bg-surface pr-[9px] pl-[3px] text-[11.5px] text-ink inset-ring inset-ring-edge-hairline';

function ProposalRow(props: { proposal: TopicProposal; topics: TopicListItem[] }) {
  const actions = useActions();
  const { proposal } = props;
  const topicName = (topicId: string) => props.topics.find((item) => item.topic.id === topicId)?.topic.name ?? topicId;
  const by = suggestedBy(proposal);
  const lead = by ? `${by.charAt(0).toUpperCase()}${by.slice(1)} suggests` : 'Agent proposes';
  return (
    <div className="mt-2.5 flex max-w-[680px] items-center gap-3 rounded-row border border-accent-line bg-accent-soft px-3 py-2 text-xs">
      <span className="min-w-0 flex-1">
        <span className="font-semibold">
          {lead}: {proposalText(proposal, topicName)}.
        </span>{' '}
        <span className="text-ink-2">{proposal.reason}</span>
      </span>
      <Button onClick={() => void actions.decideProposal(proposal.id, true)}>Accept</Button>
      <Button onClick={() => void actions.decideProposal(proposal.id, false)}>Reject</Button>
    </div>
  );
}

/** Status, goal and people from the dossier, the "since you last looked" block, and the full dossier on demand. */
function DossierSummary(props: { dossier: DossierView; topicId: string; updating: boolean }) {
  const [open, setOpen] = useState(false);
  const { dossier: view, topicId } = props;
  const { dossier } = view;
  const statusText = dossier.statusNote ? `${statusLabel(dossier.status)}: ${dossier.statusNote}` : statusLabel(dossier.status);
  const tone = STATUS_TONES[dossier.status];
  return (
    <>
      {/* Labels in a 48px column, so the values start on the same line as the timeline text. */}
      <div className="mt-3.5 grid grid-cols-[48px_minmax(0,600px)] gap-x-2.5 gap-y-1.5">
        <span className="pt-px text-[11.5px] font-medium text-hint">Status</span>
        <MemoryLine
          correction={{ kind: 'wrong', factId: null, topicId, text: statusText }}
          stale={null}
          updating={props.updating}
          corrected={view.correctedClaims.includes(statusText)}
          fixedTo={fixedText(view, statusText)}
          canRecheck
          why={lineTarget(topicId, view, 'status')}
          textClass="text-[13px] leading-normal"
        >
          <span className={`mr-[7px] inline-flex h-[18px] items-center gap-[5px] rounded-full pr-[7px] pl-1.5 align-[1px] text-[10.5px] font-semibold ${tone.pill}`}>
            <span aria-hidden="true" className={`size-[5px] rounded-full ring-2 ${tone.dot}`} />
            {statusLabel(dossier.status)}
          </span>
          <span className="text-ink">{dossier.statusNote}</span>
        </MemoryLine>
        {dossier.goal && <span className="pt-px text-[11.5px] font-medium text-hint">Goal</span>}
        {dossier.goal && (
          <MemoryLine
            correction={{ kind: 'wrong', factId: null, topicId, text: dossier.goal }}
            stale={null}
            updating={props.updating}
            corrected={view.correctedClaims.includes(dossier.goal)}
            fixedTo={fixedText(view, dossier.goal)}
            canRecheck
            why={lineTarget(topicId, view, 'goal')}
            textClass="text-[13px] leading-normal"
          >
            {dossier.goal}
          </MemoryLine>
        )}
      </div>
      <div className="mt-[22px]">
        <SinceLastLooked dossier={view} topicId={topicId} updating={props.updating} />
      </div>
      <div className="mt-[18px] flex flex-wrap items-center gap-[5px]">
        {dossier.people.map((person) => (
          <span key={person.login} className={personChip} title={person.note}>
            <Avatar login={person.login} size="xs" />
            <span className="font-medium">{person.login}</span>
            <span className="text-hint">{person.role}</span>
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ml-auto flex h-[22px] items-center gap-[5px] rounded-control pr-1.5 pl-2 text-[11.5px] font-medium text-accent hover:bg-accent-soft"
        >
          Dossier
          <span className="flex h-[15px] items-center rounded bg-accent-soft px-1 font-mono text-[10px] font-semibold text-stack-tag-ink">v{view.version}</span>
          <span className={open ? 'rotate-180' : ''}>
            <ChevronIcon />
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-2.5">
          <DossierPanel dossier={view} topicId={topicId} updating={props.updating} />
        </div>
      )}
    </>
  );
}

/** Breadcrumb, name, who drives, the dossier (or the plain summary before one exists) and what the user told the agent. */
export function TopicHeader(props: { detail: TopicDetail; group: TopicGroup; topics: TopicListItem[] }) {
  const { topic, tiles, pendingProposals, dossier, placement } = props.detail;
  const actions = useActions();
  const counts = countPrs(tiles);
  const prCount = counts.pinged + counts.pulledIn;
  // A catch-up run on the topic updates the dossier too; a PR of the topic writing its glance says one is going.
  const writing = tiles.some((view) => view.prs.some((pr) => pr.glanceState === 'writing'));
  const updating = updatingNow({ syncing: actions.syncing, writing });
  const crumbs = [topic.status === 'retired' ? 'Finished' : props.group === 'needs_you' ? 'Needs you' : 'Quiet'];
  if (placement?.area) {
    crumbs.push(placement.area);
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[5px] text-[11px] text-hint">
        <span>Topics</span>
        {crumbs.map((crumb, index) => (
          <span key={crumb} className="flex items-center gap-[5px]">
            <span className="-rotate-90 text-ghost">
              <ChevronIcon size={8} />
            </span>
            <span className={index === crumbs.length - 1 ? 'font-medium text-ink-2' : ''}>{crumb}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-[22px] leading-[1.2] font-[650] tracking-[-0.024em] text-balance">{topic.name}</h1>
        <span className="flex gap-1">
          {topic.driver && topic.userRole !== 'driver' && (
            <span className={`${pill} pr-2 pl-[3px]`}>
              <Avatar login={topic.driver} size="xxs" />
              <span>
                <span className="font-[550] text-ink">{topic.driver}</span> drives
              </span>
            </span>
          )}
          <span className={`${pill} px-2`} title="Your role in this topic">
            {ROLE_LABELS[topic.userRole]}
          </span>
          <span className={`${pill} px-2`}>
            <span className="font-mono text-[10px] font-semibold tabular-nums">{prCount}</span>
            <span className="text-hint">{prCount === 1 ? 'PR' : 'PRs'}</span>
          </span>
        </span>
      </div>
      {placement && (
        <div className="mt-1.5">
          <RelationLine placement={placement} topicId={topic.id} dossierVersion={dossier?.dossier.relation ? dossier.version : null} updating={updating} />
        </div>
      )}
      {topic.summary && <p className="mt-4 max-w-[600px] text-[13.5px] leading-[1.6] tracking-[-0.003em] text-pretty text-ink-2">{topic.summary}</p>}
      {dossier && <DossierSummary dossier={dossier} topicId={topic.id} updating={updating} />}
      {topic.tailoring && (
        <div className="mt-2.5 flex items-start gap-2 text-xs leading-normal text-muted">
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
