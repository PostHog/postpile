// Small status chips used across panes: verdict, provenance, PR state.
import type { Provenance, Verdict } from '@code-manager/core';
import type { PrLook } from '../lib/pr.ts';
import { PrIcon } from './icons.tsx';

const VERDICTS: Record<Verdict, { glyph: string; label: string; tone: string }> = {
  LOOKS_SAFE: { glyph: '✓', label: 'Looks safe', tone: 'bg-safe-soft text-safe' },
  LOOK_CLOSER: { glyph: '◉', label: 'Look closer', tone: 'bg-closer-soft text-closer' },
  NOT_YOURS: { glyph: '–', label: 'Not yours', tone: 'bg-segment text-muted' },
};

/** Greyed on done tiles; "stale" when the glance was made for an older state. */
export function VerdictPill(props: { verdict: Verdict | null; stale?: boolean; greyed?: boolean }) {
  if (!props.verdict) {
    return (
      <span className="flex h-[19px] items-center rounded-full border border-dashed border-frame px-[7px] text-[10.5px] font-medium text-faint">
        No glance yet
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

export function ProvenanceTag(props: { provenance: Provenance }) {
  if (props.provenance.kind === 'pinged') {
    return (
      <span className="flex h-[17px] items-center rounded border border-ink bg-ink px-1.5 text-[10px] font-medium text-on-accent">
        pinged
      </span>
    );
  }
  return (
    <span className="flex h-[17px] items-center rounded border border-dashed border-dot-quiet px-1.5 text-[10px] font-medium text-muted">
      pulled in
    </span>
  );
}

const LOOK_TONES: Record<PrLook, { label: string; tone: string; icon: string; dot: string }> = {
  open: { label: 'Open', tone: 'bg-open-soft text-safe', icon: 'text-open', dot: 'bg-open' },
  draft: { label: 'Draft', tone: 'bg-segment text-muted', icon: 'text-faint', dot: 'bg-faint' },
  merged: { label: 'Merged', tone: 'bg-merged-soft text-merged-ink', icon: 'text-merged', dot: 'bg-merged' },
  closed: { label: 'Closed', tone: 'bg-closed-soft text-closed', icon: 'text-closed', dot: 'bg-closed' },
};

/** Text color class for a PR icon in the given state. */
export function lookIconTone(look: PrLook): string {
  return LOOK_TONES[look].icon;
}

/** Background class for a small state dot. */
export function lookDotTone(look: PrLook): string {
  return LOOK_TONES[look].dot;
}

export function StatePill(props: { look: PrLook }) {
  const look = LOOK_TONES[props.look];
  return (
    <span className={`flex h-[21px] items-center gap-[5px] rounded-full pr-2 pl-1.5 text-[11px] font-semibold ${look.tone}`}>
      <PrIcon size={11} strokeWidth={1.8} />
      {look.label}
    </span>
  );
}
