// Line icons from the "Crisp native" mockup. They draw with currentColor, so
// color them with text-* utilities.
import type { TileKind } from '@code-manager/core';

interface IconProps {
  size?: number;
  className?: string;
}

export function PrIcon(props: IconProps & { strokeWidth?: number }) {
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

export function StackIcon(props: IconProps) {
  const size = props.size ?? 13;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={props.className} aria-hidden="true">
      <path d="M8 1.8l6 3-6 3-6-3z" />
      <path d="M2 8l6 3 6-3M2 11.2l6 3 6-3" />
    </svg>
  );
}

export function SetIcon(props: IconProps) {
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

export function LogoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="5.5" width="11" height="11" rx="3" fill="none" stroke="var(--faint)" strokeWidth="1.4" />
      <rect x="4.5" y="3.5" width="11" height="11" rx="3" fill="var(--bg-surface)" stroke="var(--muted)" strokeWidth="1.4" />
      <rect x="7.5" y="1.5" width="11" height="11" rx="3" fill="var(--accent)" />
      <circle cx="15.2" cy="4.6" r="1.6" fill="var(--bg-surface)" />
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

export function MentionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" />
      <path d="M10.6 8v1.2a1.8 1.8 0 0 0 3.4.8A6 6 0 1 0 11 13.2" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
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

export function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}

/** Left-pointing chevron for "Back"; ForwardIcon mirrors it. */
export function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </svg>
  );
}

export function ForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" />
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
