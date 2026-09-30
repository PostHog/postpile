// Small status chips used across panes: verdict, why it's here, PR status.
import type { ReactNode } from 'react';
import type { ForWhom, Provenance, TilePendingWrite, TopicRelation, Verdict, WhyCode } from '@postpile/core';
import { pendingWriteTitle } from '../lib/guard.ts';
import type { GlanceStateText } from '../lib/glance.ts';
import { staleVerdictTitle, staleWord } from '../lib/staleness.ts';
import type { StateWord } from '../lib/pr.ts';
import { relationLabel } from '../lib/sidebar.ts';
import { type StackPlace, stackPlaceLabel, stackPlaceTitle } from '../lib/stacks.ts';
import { forWhomLabel, whyTitle } from '../lib/why.ts';
import { ClockIcon, DashIcon, Glyph, PencilIcon, RingDotIcon, SpinnerIcon, StackIcon } from './icons.tsx';

const VERDICTS: Record<Verdict, { icon: ReactNode; label: string; tone: string }> = {
  LOOKS_SAFE: { icon: <Glyph glyph="check" size={11} strokeWidth={2.2} />, label: 'Looks safe', tone: 'bg-safe-soft text-safe inset-ring-safe-line' },
  LOOK_CLOSER: { icon: <RingDotIcon size={10} />, label: 'Look closer', tone: 'bg-closer-soft text-closer inset-ring-closer-line' },
  NOT_YOURS: { icon: <DashIcon size={11} />, label: 'Not yours', tone: 'bg-segment text-muted inset-ring-hairline' },
};

/**
 * The coral dot in front of a PR number on a PR that keeps its tile from
 * being done (core `TileView.notDonePrKeys`), on unread and open tiles. The one coral
 * mark that is not "new since you looked" (DESIGN.md "Actions act on what
 * you look at": no second, read-only dot).
 */
export function NotDoneDot() {
  return <span role="img" aria-label="Not done yet" title="Not done yet" className="size-1.5 shrink-0 rounded-full bg-unread ring-2 ring-unread-soft" />;
}

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
 * Greyed on done tiles; "· out of date" when the glance was made for an
 * older state, "· updating" while a sync or catch-up writes a new one
 * (`lib/staleness.ts`). Without a verdict it says where the glance stands
 * (`glanceStateText`). Same height as the "for whom" chip.
 */
export function VerdictPill(props: { verdict: Verdict | null; stale?: boolean; updating?: boolean; greyed?: boolean; missing?: GlanceStateText | null }) {
  if (!props.verdict) {
    const text = props.missing;
    const tone = text?.problem ? 'border-status-bad text-status-bad' : 'border-frame text-hint';
    return (
      <span
        title={text?.card}
        className={`flex h-5 items-center gap-[5px] rounded-full border border-dashed px-2 text-[11px] font-medium whitespace-nowrap ${tone}`}
      >
        {text?.spinner && <SpinnerIcon />}
        {text?.pill ?? 'No glance yet'}
      </span>
    );
  }
  const verdict = VERDICTS[props.verdict];
  const tone = props.greyed ? 'bg-segment text-muted inset-ring-hairline' : verdict.tone;
  return (
    <span
      className={`flex h-5 shrink-0 items-center gap-[5px] rounded-full pr-2 pl-1.5 text-[11px] font-semibold whitespace-nowrap inset-ring ${tone}`}
      title={props.stale ? staleVerdictTitle(props.updating ?? false) : undefined}
    >
      {verdict.icon}
      {verdict.label}
      {props.stale && <span className="font-normal opacity-70">· {staleWord(props.updating ?? false)}</span>}
    </span>
  );
}

// Each chip carries an inset ring in its own ink at 10%.
const FOR_WHOM_TONES: Record<Exclude<ForWhom['kind'], 'none'>, string> = {
  you: 'bg-honey-soft text-honey-ink inset-ring-honey-ink/10',
  team: 'bg-sea-soft text-sea-ink inset-ring-sea-ink/10',
  own: 'bg-segment text-ink inset-ring-ink/10',
};

const FOR_WHOM_SIZES = {
  tile: 'h-5 px-2 text-[11px]',
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
  const look = props.greyed ? 'bg-why-done text-muted inset-ring-muted/10' : FOR_WHOM_TONES[forWhom.kind];
  return (
    <span
      title={whyTitle(props.code, props.provenance)}
      className={`flex shrink-0 items-center rounded-full font-[650] whitespace-nowrap inset-ring ${FOR_WHOM_SIZES[props.size ?? 'tile']} ${look}`}
    >
      {forWhomLabel(forWhom)}
    </span>
  );
}

const STATE_WORD_LOOKS: Record<Exclude<StateWord['kind'], 'draft'>, { icon: ReactNode; tone: string }> = {
  review: { icon: <Glyph glyph="eye" size={12} strokeWidth={1.7} />, tone: 'text-closer' },
  approved: { icon: <Glyph glyph="check" size={12} strokeWidth={1.9} />, tone: 'text-status-good' },
  changes: { icon: <Glyph glyph="changes" size={12} strokeWidth={1.7} />, tone: 'text-status-bad' },
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
        className="flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] bg-surface px-1.5 text-[9.5px] font-bold tracking-[0.07em] whitespace-nowrap text-muted inset-ring inset-ring-frame"
      >
        <PencilIcon size={9} />
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
    <span className={`inline-flex h-[15px] shrink-0 items-center rounded px-[5px] align-[1px] text-[9.5px] font-[650] tracking-[0.03em] ${RELATION_TONES[props.relation]}`}>
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
      className="flex h-4 shrink-0 items-center rounded-[4px] bg-subtle px-[5px] font-mono text-[9.75px] whitespace-nowrap text-hint inset-ring inset-ring-pill-line"
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
  const look = props.greyed ? 'bg-segment text-muted inset-ring-hairline' : 'bg-stack-tag text-stack-tag-ink inset-ring-stack-tag-line';
  return (
    <span
      title={stackPlaceTitle(props.place)}
      className={`flex h-[18px] shrink-0 items-center gap-[3px] rounded-[5px] px-[5px] font-mono text-[10.5px] font-semibold whitespace-nowrap inset-ring ${look}`}
    >
      <StackIcon size={11} strokeWidth={1.6} />
      {stackPlaceLabel(props.place)}
    </span>
  );
}
