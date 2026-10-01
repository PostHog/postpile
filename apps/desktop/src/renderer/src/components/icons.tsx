// Line icons from the "Crisp native" mockup. They draw with currentColor, so
// color them with text-* utilities.
import type { PrLifecycle, TileKind } from '@postpile/core';
import type { EventGlyph } from '../lib/events.ts';

interface IconProps {
  size?: number;
  className?: string;
}

function PrIcon(props: IconProps & { strokeWidth?: number }) {
  const size = props.size ?? 13;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 1.4} className={props.className} aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.8" />
      <circle cx="4" cy="12.5" r="1.8" />
      <circle cx="12" cy="12.5" r="1.8" />
      <path d="M4 5.3v5.4M12 10.7V6a2 2 0 0 0-2-2H7.5" />
    </svg>
  );
}

/** Layers: the stack kind icon, and the glyph on the stack mark. */
export function StackIcon(props: IconProps & { strokeWidth?: number }) {
  const size = props.size ?? 13;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 1.4} className={props.className} aria-hidden="true">
      <path d="M8 1.8l6 3-6 3-6-3z" />
      <path d="M2 8l6 3 6-3M2 11.2l6 3 6-3" />
    </svg>
  );
}

function SetIcon(props: IconProps) {
  const size = props.size ?? 13;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" className={props.className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" />
    </svg>
  );
}

export function KindIcon(props: IconProps & { kind: TileKind }) {
  if (props.kind === 'stack') {
    return <StackIcon size={props.size} className={props.className} />;
  }
  if (props.kind === 'set') {
    return <SetIcon size={props.size} className={props.className} />;
  }
  return <PrIcon size={props.size} className={props.className} />;
}

/** A small turning arc for "Writing the glance…". Its own component: it carries the spin. */
export function SpinnerIcon(props: IconProps) {
  const size = props.size ?? 11;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`animate-spin ${props.className ?? ''}`} aria-hidden="true">
      <path d="M14 8a6 6 0 1 1-6-6" />
    </svg>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={props.className} aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  const size = props.size ?? 12;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={props.className} aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </svg>
  );
}

/** The "head → base" arrow in the detail pane's branch line, 12×8. */
export function BranchArrowIcon(props: { className?: string }) {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="M1 4h9M7.5 1.5L10 4 7.5 6.5" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M14 7.5a5.5 5.5 0 0 1-8 4.9L2.5 13.5l1-3.2A5.5 5.5 0 1 1 14 7.5z" />
    </svg>
  );
}

export function InstructionsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 2h6l3 3v9H4z" />
      <path d="M10 2v3h3M6.5 8.5h4M6.5 11h4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function QuoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 shrink-0" aria-hidden="true">
      <path d="M3 9.5C3 6.5 4.6 4.4 7 3.5l.6 1C6 5.3 5.3 6.4 5.2 7.6H7V12H3zm6 0c0-3 1.6-5.1 4-6l.6 1c-1.6.8-2.3 1.9-2.4 3.1H13V12H9z" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  const size = props.size ?? 12;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/** LockIcon with the shackle swung open: GitHub writes on. */
export function UnlockIcon(props: IconProps) {
  const size = props.size ?? 12;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
    </svg>
  );
}

/** "Pending: mark read on GitHub" on a tile. */
export function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  const size = props.size ?? 10;
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}

/** Left-pointing chevron for "Back"; ForwardIcon mirrors it. */
export function BackIcon(props: IconProps) {
  const size = props.size ?? 14;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </svg>
  );
}

export function ForwardIcon(props: IconProps) {
  const size = props.size ?? 14;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
    </svg>
  );
}

export function InboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 9l1.8-5.5h8.4L14 9v4H2z" />
      <path d="M2 9h3.5l1 1.5h3l1-1.5H14" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" />
      <path d="M6.5 14h3" />
    </svg>
  );
}

/** Two people in outline (Octicons "people"): the start of the sidebar's team pill. */
export function PeopleIcon(props: IconProps) {
  const size = props.size ?? 12;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={props.className} aria-hidden="true">
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5a4.5 4.5 0 0 1 9 0" />
      <path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 9.6a4.5 4.5 0 0 1 2.5 3.9" />
    </svg>
  );
}

/** A circle as a path, so a glyph stays one <path>. */
function ring(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 -${2 * r}z`;
}

// The event glyph set from the "Warm reach" mockup (IconSpots), 16px grid.
const GLYPH_PATHS: Record<EventGlyph, string> = {
  at: `${ring(8, 8, 2.5)} M10.5 8v1.1a1.8 1.8 0 0 0 3.5.6A6 6 0 1 0 11 13.2`,
  question: 'M2.5 3h11v7.5H7.3L4.5 13v-2.5h-2z M6.6 5.4a1.5 1.5 0 1 1 2.1 1.4c-.5.2-.7.5-.7 1 M8 9.1v.01',
  reply: 'M6 3.5L2.5 7 6 10.5 M2.5 7H10a3.5 3.5 0 0 1 3.5 3.5V13',
  eye: `M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z ${ring(8, 8, 2)}`,
  check: 'M3 8.5l3 3 7-7',
  changes: 'M3.5 1.8h6l3 3v9.4h-9z M8 5v4 M6 7h4 M6 11.5h4',
  bubble: 'M2.5 3h11v7.5H7.3L4.5 13v-2.5h-2z',
  commit: `M1.5 8h4 M10.5 8h4 ${ring(8, 8, 2.5)}`,
  merge: `${ring(4.5, 3.5, 1.6)} ${ring(4.5, 12.5, 1.6)} ${ring(11.5, 8, 1.6)} M4.5 5.1v5.8 M4.5 5.1c0 2.4 2.4 2.9 5.4 2.9`,
  closed: `${ring(4, 3.5, 1.6)} ${ring(4, 12.5, 1.6)} ${ring(12, 12.5, 1.6)} M4 5.1v5.8 M12 7.5v3.4 M10.3 2.3l3.4 3.4 M13.7 2.3l-3.4 3.4`,
  ready: `${ring(4, 3.5, 1.6)} ${ring(4, 12.5, 1.6)} ${ring(12, 12.5, 1.6)} M4 5.1v5.8 M12 10.9V6a2 2 0 0 0-2-2H7.5 M9 2.5L7.5 4 9 5.5`,
  draft: `${ring(4, 3.5, 1.6)} ${ring(4, 12.5, 1.6)} ${ring(12, 12.5, 1.6)} M4 5.1v5.8 M12 8v.01 M12 5v.01`,
  ci: `${ring(8, 8, 6.2)} M5.8 5.8l4.4 4.4 M10.2 5.8l-4.4 4.4`,
  deploy: 'M8 11.5V2.5 M4.5 6L8 2.5 11.5 6 M3 14h10',
  queue: 'M2.5 4h7 M2.5 8h7 M2.5 12h7 M12 6.2l2 1.8-2 1.8',
  bot: 'M3.5 6h9v7h-9z M8 3.5V6 M6 9.3v.01 M10 9.3v.01 M1.5 9v2 M14.5 9v2',
};

/** One event glyph. At 9px it wants the heavier 2.4 stroke, like in the mockup. */
export function Glyph(props: IconProps & { glyph: EventGlyph; strokeWidth?: number }) {
  const size = props.size ?? 9;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      <path d={GLYPH_PATHS[props.glyph]} />
    </svg>
  );
}

// PR state icons, drawn like GitHub's Octicons (simplified, stroked):
// open pull request, dashed draft circle, merge, closed pull request.
// Colors are fixed per state so a row reads at a glance.

const LIFECYCLE_TONES: Record<PrLifecycle, string> = {
  open: 'text-open',
  draft: 'text-faint',
  // Queued is on its way to merged: the merged purple, with the open-PR outline (2026-10-01).
  queued: 'text-merged',
  merged: 'text-merged',
  closed: 'text-closed',
};

const LIFECYCLE_GLYPHS: Record<Exclude<PrLifecycle, 'draft'>, EventGlyph> = {
  open: 'ready',
  queued: 'ready',
  merged: 'merge',
  closed: 'closed',
};

/** The PR's lifecycle as a colored icon; the word goes in `title` (LIFECYCLE_WORDS). */
export function PrStateIcon(props: IconProps & { lifecycle: PrLifecycle; title: string }) {
  const size = props.size ?? 14;
  const tone = `shrink-0 ${LIFECYCLE_TONES[props.lifecycle]} ${props.className ?? ''}`;
  if (props.lifecycle === 'draft') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.2" className={tone} role="img" aria-label={props.title}>
        <title>{props.title}</title>
        <circle cx="8" cy="8" r="6" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={tone}
      role="img"
      aria-label={props.title}
    >
      <title>{props.title}</title>
      <path d={GLYPH_PATHS[LIFECYCLE_GLYPHS[props.lifecycle]]} />
    </svg>
  );
}

/** Pencil, for the outlined DRAFT chip. */
export function PencilIcon(props: IconProps) {
  const size = props.size ?? 11;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="M10.8 2.7l2.5 2.5L6 12.5l-3.3.8.8-3.3z" />
    </svg>
  );
}

/** "Look closer": a ring with a dot. */
export function RingDotIcon(props: IconProps) {
  const size = props.size ?? 11;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={props.className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/** "Not yours": a short dash. */
export function DashIcon(props: IconProps) {
  const size = props.size ?? 11;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={props.className} aria-hidden="true">
      <path d="M4 8h8" />
    </svg>
  );
}

/** A file, for the "Look at first" list. */
export function FileIcon(props: IconProps) {
  const size = props.size ?? 13;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
      <path d="M9 1.8V5h3.5" />
    </svg>
  );
}
