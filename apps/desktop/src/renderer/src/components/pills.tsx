// Small status chips used across panes: verdict, why it's here, PR status.
import type { ReactNode } from 'react';
import type { ForWhom, Provenance, TilePendingWrite, TopicRelation, Verdict, WhyCode } from '@postpile/core';
import { pendingWriteTitle } from '../lib/guard.ts';
import type { GlanceStateText } from '../lib/glance.ts';
import type { StateWord } from '../lib/pr.ts';
import { relationLabel } from '../lib/sidebar.ts';
import { type StackPlace, stackPlaceLabel, stackPlaceTitle } from '../lib/stacks.ts';
import { forWhomLabel, whyTitle } from '../lib/why.ts';
import { ClockIcon, DashIcon, Glyph, PencilIcon, RingDotIcon, SpinnerIcon, StackIcon } from './icons.tsx';

const VERDICTS: Record<Verdict, { icon: ReactNode; label: string; tone: string }> = {
  LOOKS_SAFE: { icon: <Glyph glyph="check" size={11} strokeWidth={2.2} />, label: 'Looks safe', tone: 'border-safe-line bg-safe-soft text-safe' },
  LOOK_CLOSER: { icon: <RingDotIcon size={10} />, label: 'Look closer', tone: 'border-match-line bg-closer-soft text-closer' },
  NOT_YOURS: { icon: <DashIcon size={11} />, label: 'Not yours', tone: 'border-hairline bg-segment text-muted' },
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

/**
 * Greyed on done tiles; "stale" when the glance was made for an older state.
 * Without a verdict it says where the glance stands (`glanceStateText`).
 * Same height as the "for whom" chip.
 */
export function VerdictPill(props: { verdict: Verdict | null; stale?: boolean; greyed?: boolean; missing?: GlanceStateText | null }) {
  if (!props.verdict) {
    const text = props.missing;
    const tone = text?.problem ? 'border-status-bad text-status-bad' : 'border-frame text-faint';
    return (
      <span
        title={text?.card}
        className={`flex h-[22px] items-center gap-[5px] rounded-full border border-dashed px-2 text-[11px] font-medium whitespace-nowrap ${tone}`}
      >
        {text?.spinner && <SpinnerIcon />}
        {text?.pill ?? 'No glance yet'}
      </span>
    );
  }
  const verdict = VERDICTS[props.verdict];
  const tone = props.greyed ? 'border-hairline bg-segment text-muted' : verdict.tone;
  return (
    <span
      className={`flex h-[22px] shrink-0 items-center gap-[5px] rounded-full border pr-2 pl-[7px] text-[11px] font-semibold whitespace-nowrap ${tone}`}
      title={props.stale ? 'Stale: the PR or your instructions moved since this glance. The next catch-up or sync refreshes it.' : undefined}
    >
      {verdict.icon}
      {verdict.label}
      {props.stale && <span className="font-normal opacity-70">· stale</span>}
    </span>
  );
}

const FOR_WHOM_TONES: Record<Exclude<ForWhom['kind'], 'none'>, string> = {
  you: 'bg-honey-soft text-honey-ink',
  team: 'bg-sea-soft text-sea-ink',
  own: 'bg-segment text-ink',
};

const FOR_WHOM_SIZES = {
  tile: 'h-[22px] px-[9px] text-[11.5px]',
  row: 'h-[17px] px-1.5 text-[10px]',
};

/**
 * "For whom" as words: "For you" (honey), "For team-devex" (sea), "Your PR"
 * (neutral). Nothing for everything else. The tooltip keeps the long reason
 * (`whyTitle`). Greyed on done tiles.
 */
export function ForWhomChip(props: { forWhom: ForWhom; code: WhyCode; provenance?: Provenance; greyed?: boolean; size?: keyof typeof FOR_WHOM_SIZES }) {
  const { forWhom } = props;
  if (forWhom.kind === 'none') {
    return null;
  }
  const look = props.greyed ? 'bg-why-done text-muted' : FOR_WHOM_TONES[forWhom.kind];
  return (
    <span
      title={whyTitle(props.code, props.provenance)}
      className={`flex shrink-0 items-center rounded-full font-bold whitespace-nowrap ${FOR_WHOM_SIZES[props.size ?? 'tile']} ${look}`}
    >
      {forWhomLabel(forWhom)}
    </span>
  );
}

const STATE_WORD_LOOKS: Record<Exclude<StateWord['kind'], 'draft'>, { icon: ReactNode; tone: string }> = {
  review: { icon: <Glyph glyph="eye" size={13} strokeWidth={1.6} />, tone: 'text-closer' },
  approved: { icon: <Glyph glyph="check" size={13} strokeWidth={1.8} />, tone: 'text-status-good' },
  changes: { icon: <Glyph glyph="changes" size={13} strokeWidth={1.6} />, tone: 'text-status-bad' },
  merged: { icon: null, tone: 'text-merged-ink' },
  closed: { icon: null, tone: 'text-status-bad' },
};

const STATE_WORD_SIZES = {
  row: 'text-[11.5px]',
  md: 'text-[13px]',
};

/**
 * A PR's state word with its icon (`reviewWord` / `rowStateWord` in
 * lib/pr.ts): "Needs review" honey eye, "Approved" green check, "Changes
 * requested" red, merged / closed as the colored word, drafts as an
 * outlined DRAFT chip with a pencil. Never CI.
 */
export function StateWordLabel(props: { word: StateWord; size?: keyof typeof STATE_WORD_SIZES }) {
  const { word } = props;
  if (word.kind === 'draft') {
    return (
      <span
        title={word.title}
        className="flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-frame bg-surface px-1.5 text-[10px] font-bold tracking-[0.06em] whitespace-nowrap text-muted"
      >
        <PencilIcon size={10} />
        DRAFT
      </span>
    );
  }
  const look = STATE_WORD_LOOKS[word.kind];
  return (
    <span title={word.title} className={`flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap ${STATE_WORD_SIZES[props.size ?? 'row']} ${look.tone}`}>
      {look.icon}
      {word.text}
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

/**
 * The stack mark (variant A): a small light-blue tag with the layers glyph
 * and the layer's position, "1/3" (1 = bottom). Sits between the #number
 * and the title on PR rows, and before the detail pane's title. Lone PRs
 * get none: callers only render it with a place. Grey on done tiles.
 */
// Semibold, not bold: the bundled JetBrains Mono stops at 600, and 700 would be faux bold.
export function StackMark(props: { place: StackPlace; greyed?: boolean }) {
  const look = props.greyed ? 'border-hairline bg-segment text-muted' : 'border-stack-tag-line bg-stack-tag text-stack-tag-ink';
  return (
    <span
      title={stackPlaceTitle(props.place)}
      className={`flex h-[18px] shrink-0 items-center gap-[3px] rounded-[5px] border px-[5px] font-mono text-[10.5px] font-semibold whitespace-nowrap ${look}`}
    >
      <StackIcon size={11} strokeWidth={1.6} />
      {stackPlaceLabel(props.place)}
    </span>
  );
}
