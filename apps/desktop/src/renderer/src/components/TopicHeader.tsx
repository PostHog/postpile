import { useState } from 'react';
import type { DossierStatus, DossierView, TopicDetail, TopicListItem, TopicProposal, UserRole } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { fixedText, statusLabel } from '../lib/memory.ts';
import { lineTarget } from '../lib/sources.ts';
import { updatingNow } from '../lib/staleness.ts';
import { proposalText, suggestedBy } from '../lib/proposals.ts';
import { prMixTitle } from '../lib/pr-mix.ts';
import { sectionLook } from '../lib/sections.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { DossierPanel } from './DossierPanel.tsx';
import { DriverMenu } from './DriverMenu.tsx';
import { ChevronIcon, PrStateIcon, QuoteIcon } from './icons.tsx';
import { MemoryLine } from './MemoryLine.tsx';
import { RelationLine } from './RelationLine.tsx';
import { SinceLastLooked } from './SinceLastLooked.tsx';
import { TopicLessons } from './TopicLessons.tsx';
import { TopicRepo } from './TopicRepo.tsx';
import { YourMoveChip } from './YourMoveChip.tsx';

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
  blocked: { pill: 'bg-status-bad-soft text-status-bad', dot: 'bg-status-bad ring-status-bad/18' },
  winding_down: { pill: 'bg-amber-soft text-amber-ink', dot: 'bg-amber ring-amber/18' },
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

interface Crumb {
  label: string;
  /** The sidebar section's dot colour, on the section crumb only. */
  dot: string | null;
}

/**
 * Topics › section › area. The section is the one the sidebar lists the topic
 * under (core's `TopicDetail.section`, the Archive for a retired topic), with
 * the same label and dot.
 */
function breadcrumbs(detail: TopicDetail): Crumb[] {
  const look = sectionLook(detail.section);
  const crumbs: Crumb[] = [{ label: look.label, dot: look.dot }];
  if (detail.placement?.area) {
    crumbs.push({ label: detail.placement.area, dot: null });
  }
  return crumbs;
}

/**
 * Every PR in the topic (core's `prRollup.total`, found and pulled-in ones
 * included) behind the same state icon as the sidebar row, with the
 * lifecycle and review mix as the tooltip.
 */
function PrCountPill(props: { detail: TopicDetail }) {
  const { prRollup } = props.detail;
  const title = prMixTitle(prRollup);
  return (
    <span className={`${pill} px-2`} title={title}>
      {prRollup.state && <PrStateIcon state={prRollup.state} size={11} title={title} />}
      <span className="font-mono text-[10px] font-semibold tabular-nums">{prRollup.total}</span>
      <span className="text-hint">{prRollup.total === 1 ? 'PR' : 'PRs'}</span>
    </span>
  );
}

/** Breadcrumb, name, who drives (a menu that moves the topic), the dossier (or the plain summary before one exists), what the user told the agent and the lessons waiting for a decision. */
export function TopicHeader(props: { detail: TopicDetail; topics: TopicListItem[] }) {
  const { topic, pendingProposals, dossier, placement, driver, repoLine } = props.detail;
  const actions = useActions();
  // Only a whole-topic catch-up rewrites the dossier; a glance-only refresh on look does not (server decides).
  const updating = updatingNow({ syncing: actions.syncing, writing: props.detail.memoryUpdating });
  const crumbs = breadcrumbs(props.detail);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[5px] text-[11px] text-hint">
        <span>Topics</span>
        {crumbs.map((crumb, index) => (
          <span key={crumb.label} className="flex items-center gap-[5px]">
            <span className="-rotate-90 text-ghost">
              <ChevronIcon size={8} />
            </span>
            {crumb.dot && <span aria-hidden="true" className={`size-[5px] rounded-[1.5px] ${crumb.dot}`} />}
            <span className={index === crumbs.length - 1 ? 'font-medium text-ink-2' : ''}>{crumb.label}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-[22px] leading-[1.2] font-[650] tracking-[-0.024em] text-balance">{topic.name}</h1>
        <span className="flex gap-1">
          {driver && <DriverMenu topicId={topic.id} driver={driver} />}
          {/* "You drive" already says the role. */}
          {topic.userRole !== 'driver' && driver?.kind !== 'you' && (
            <span className={`${pill} px-2`} title="Your role in this topic">
              {ROLE_LABELS[topic.userRole]}
            </span>
          )}
          <PrCountPill detail={props.detail} />
        </span>
        <YourMoveChip moves={props.detail.yourMoves} />
      </div>
      {placement && (
        <div className="mt-1.5">
          <RelationLine
            placement={placement}
            repo={repoLine}
            topicId={topic.id}
            dossierVersion={dossier?.dossier.relation ? dossier.version : null}
            updating={updating}
          />
        </div>
      )}
      {/* Without a placement there is no owner line, but the repo still shows in its spot. */}
      {!placement && repoLine && (
        <div className="mt-1.5 text-[11.5px] leading-normal">
          <TopicRepo line={repoLine} />
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
      {/* Lessons from the user's pushback sit right under what they told the agent: "Remember in this topic" adds to that line. */}
      <TopicLessons topicId={topic.id} />
      {pendingProposals.map((proposal) => (
        <ProposalRow key={proposal.id} proposal={proposal} topics={props.topics} />
      ))}
    </div>
  );
}
