// Small status chips used across panes: verdict, why it's here, PR status.
import type { GlanceGap, PrStatus, Provenance, TilePendingWrite, TopicRelation, Verdict, WhyCode } from '@postpile/core';
import { pendingWriteTitle } from '../lib/guard.ts';
import { glanceGapText } from '../lib/glance.ts';
import { statusParts, type StatusTone } from '../lib/pr.ts';
import { relationLabel } from '../lib/sidebar.ts';
import { WHY, whyTitle, type WhyTone } from '../lib/why.ts';
import { ClockIcon } from './icons.tsx';

const VERDICTS: Record<Verdict, { glyph: string; label: string; tone: string }> = {
  LOOKS_SAFE: { glyph: '✓', label: 'Looks safe', tone: 'bg-safe-soft text-safe' },
  LOOK_CLOSER: { glyph: '◉', label: 'Look closer', tone: 'bg-closer-soft text-closer' },
  NOT_YOURS: { glyph: '–', label: 'Not yours', tone: 'bg-segment text-muted' },
};

/** "pending: mark read on GitHub": a mark-read made while writes were locked. Neutral, not coral: nothing is new. */
export function PendingWritePill(props: { pending: TilePendingWrite }) {
  const failed = props.pending.error !== null;
  return (
    <span
      title={pendingWriteTitle(props.pending.error)}
      className={`flex h-[19px] shrink-0 items-center gap-1 rounded-full border px-[7px] text-[10.5px] font-medium whitespace-nowrap ${
        failed ? 'border-status-bad text-status-bad' : 'border-pill-line bg-subtle text-muted'
      }`}
    >
      <ClockIcon />
      {failed ? 'pending: send failed' : 'pending: mark read on GitHub'}
    </span>
  );
}

/** "Your PR" on tiles of the viewer's own PRs: the neutral "yours" look of the why badges, in words. */
export function OwnPrPill(props: { greyed?: boolean }) {
  return (
    <span
      title="You wrote this PR: nothing to approve, it waits on reviewers or on you to merge"
      className={`flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[10.5px] font-semibold ${props.greyed ? 'bg-why-done text-muted' : 'bg-segment text-ink'}`}
    >
      Your PR
    </span>
  );
}

/** Greyed on done tiles; "stale" when the glance was made for an older state. */
export function VerdictPill(props: { verdict: Verdict | null; stale?: boolean; greyed?: boolean; gap?: GlanceGap | null }) {
  if (!props.verdict) {
    const text = glanceGapText(props.gap ?? null);
    const tone = props.gap?.reason === 'failed' ? 'border-status-bad text-status-bad' : 'border-frame text-faint';
    return (
      <span title={text.card} className={`flex h-[19px] items-center rounded-full border border-dashed px-[7px] text-[10.5px] font-medium whitespace-nowrap ${tone}`}>
        {text.pill}
      </span>
    );
  }
  const verdict = VERDICTS[props.verdict];
  const tone = props.greyed ? 'bg-segment text-muted' : verdict.tone;
  return (
    <span
      className={`flex h-[19px] items-center gap-1 rounded-full pr-[7px] pl-[5px] text-[10.5px] font-semibold tracking-[0.01em] ${tone}`}
      title={props.stale ? 'Stale: the PR or your instructions moved since this glance. Sync to refresh.' : undefined}
    >
      {verdict.glyph} {verdict.label}
      {props.stale && <span className="font-normal opacity-70">· stale</span>}
    </span>
  );
}

const WHY_TONES: Record<WhyTone, string> = {
  you: 'bg-honey-soft text-honey-ink',
  team: 'bg-sea-soft text-sea-ink',
  own: 'bg-segment text-ink',
  passive: 'bg-quiet-soft text-muted',
  context: 'border border-dashed border-ghost text-faint',
};

const WHY_SIZES = {
  tile: 'h-5 px-1.5 text-[10.5px] font-bold',
  row: 'h-[17px] w-[26px] text-[9.5px] font-bold',
};

/**
 * "Why it's here": a mono code (RV, RT, @, ...) tinted by who it is aimed
 * at. Greyed on done tiles; the stack-context outline stays an outline.
 */
export function WhyBadge(props: { code: WhyCode; provenance?: Provenance; greyed?: boolean; size?: keyof typeof WHY_SIZES }) {
  const tone = WHY[props.code].tone;
  const look = props.greyed && tone !== 'context' ? 'bg-why-done text-muted' : WHY_TONES[tone];
  return (
    <span
      title={whyTitle(props.code, props.provenance)}
      className={`flex shrink-0 items-center justify-center rounded-[5px] font-mono leading-none ${WHY_SIZES[props.size ?? 'tile']} ${look}`}
    >
      {props.code}
    </span>
  );
}

const STATUS_TONES: Record<StatusTone, string> = {
  good: 'bg-status-good-soft text-status-good',
  neutral: 'bg-quiet-soft text-muted',
  bad: 'bg-status-bad-soft text-status-bad',
  merged: 'bg-merged-soft text-merged-ink',
  queued: 'bg-status-queued-soft text-status-queued',
};

/** Same neutral grey as the why badge on done tiles: every segment loses its tint. */
const STATUS_GREYED = 'bg-why-done text-muted';

/** One segment pill: lifecycle, then review and checks when they apply. Greyed on done tiles. */
export function StatusPill(props: { status: PrStatus; size?: 'sm' | 'md'; greyed?: boolean }) {
  const parts = statusParts(props.status);
  const height = props.size === 'md' ? 'h-[21px] text-[11px]' : 'h-[18px] text-[9.5px]';
  return (
    <span title={parts.map((part) => part.title).join(' · ')} className={`flex shrink-0 overflow-hidden rounded-[5px] border border-pill-line ${height}`}>
      {parts.map((part, index) => (
        <span
          key={part.text}
          className={`flex items-center px-[5px] font-semibold whitespace-nowrap ${index > 0 ? 'border-l border-surface' : ''} ${props.greyed ? STATUS_GREYED : STATUS_TONES[part.tone]}`}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}

const RELATION_TONES: Record<TopicRelation, string> = {
  team: 'bg-sea-soft text-sea-ink',
  routed: 'bg-closer-soft text-closer',
  fyi: 'bg-segment text-muted',
};

/** Small "team" / "routed" / "FYI" tag next to a topic name. */
export function RelationBadge(props: { relation: TopicRelation }) {
  return (
    <span className={`flex h-[15px] shrink-0 items-center rounded px-1 text-[9.5px] font-semibold tracking-[0.02em] ${RELATION_TONES[props.relation]}`}>
      {relationLabel(props.relation)}
    </span>
  );
}

/**
 * Small neutral repo name on a tile or PR row from another repo than the
 * chosen one (or the topic's main repo). Never a filter, just where it lives.
 */
export function RepoLabel(props: { label: string }) {
  return (
    <span
      title={`In ${props.label}, another repo than the rest of this topic or the one picked in the repo menu`}
      className="shrink-0 rounded-[4px] border border-pill-line bg-subtle px-1 font-mono text-[10px] leading-[14px] text-muted"
    >
      {props.label}
    </span>
  );
}
