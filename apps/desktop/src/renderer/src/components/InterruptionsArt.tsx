import type { InterruptionsMode } from '@postpile/core';

// Small illustrations for the setup step "Your day", one per mode. Colors
// come from tokens (honey = aimed at you, sea for the check, ink for the app
// mark); the keyframes are the interrupt-* tokens in app.css. Everything
// moves only under motion-safe:, so with reduced motion each piece rests in
// its end state. The names and PR are invented sample text.

/** A Mac notification as the art draws it: the ink "P" app mark, a title and one quiet line. */
function NotificationCard(props: { title: string; detail: string; className: string }) {
  return (
    <span className={`flex items-center gap-[7px] rounded-[10px] bg-surface px-[9px] py-[7px] shadow-menu ${props.className}`}>
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-ink text-[10px] font-bold text-on-ink">P</span>
      <span className="flex min-w-0 flex-col gap-px text-left leading-[normal]">
        <span className="text-[10.5px] font-semibold text-ink">{props.title}</span>
        <span className="truncate text-[10px] text-hint">{props.detail}</span>
      </span>
    </span>
  );
}

/** Never: three tiles settle into a stack (the top one aimed at you), a check pops in, a faint "z z" drifts. */
function NeverArt() {
  return (
    <svg viewBox="0 0 120 72" width="140" height="84" aria-hidden="true">
      <g className="motion-safe:animate-interrupt-settle motion-safe:[animation-delay:0.5s]">
        <rect x="18" y="44" width="58" height="14" rx="4" fill="var(--bg-surface)" stroke="var(--hairline-strong)" />
        <rect x="25" y="49.5" width="26" height="3" rx="1.5" fill="var(--bg-chip)" />
      </g>
      <g className="motion-safe:animate-interrupt-settle motion-safe:[animation-delay:0.25s]">
        <rect x="18" y="28" width="58" height="14" rx="4" fill="var(--bg-surface)" stroke="var(--hairline-strong)" />
        <rect x="25" y="33.5" width="34" height="3" rx="1.5" fill="var(--bg-chip)" />
      </g>
      <g className="motion-safe:animate-interrupt-settle">
        <rect x="18" y="12" width="58" height="14" rx="4" fill="var(--honey-soft)" stroke="var(--honey)" strokeOpacity="0.5" />
        <rect x="18" y="12" width="3" height="14" rx="1.5" fill="var(--honey)" />
        <rect x="26" y="17.5" width="30" height="3" rx="1.5" fill="var(--honey-ink)" fillOpacity="0.35" />
      </g>
      <g className="origin-center [transform-box:fill-box] motion-safe:animate-interrupt-check">
        <circle cx="92" cy="48" r="9" fill="var(--sea-soft)" />
        <path d="M88 48l3 3 5-6" fill="none" stroke="var(--sea-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="font-sans font-semibold motion-safe:animate-interrupt-zz" fill="var(--faint)">
        <text x="90" y="24" fontSize="9">
          z
        </text>
        <text x="97" y="17" fontSize="7">
          z
        </text>
      </g>
    </svg>
  );
}

/** In batches: a clock with a turning hand; three slim cards gather, then fold into one roundup. */
function BatchesArt() {
  const slim = 'absolute left-1.5 h-3 w-[150px] rounded-sm motion-safe:animate-interrupt-gather';
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 44 72" width="30" height="50" aria-hidden="true">
        <circle cx="22" cy="36" r="15" fill="var(--bg-surface)" stroke="var(--ghost)" strokeWidth="1.6" />
        <path d="M22 36V27" stroke="var(--faint)" strokeWidth="1.8" strokeLinecap="round" />
        {/* The hand turns around the clock's center, in the svg's own coordinates. */}
        <g className="[transform-box:view-box] motion-safe:animate-interrupt-hand" style={{ transformOrigin: '22px 36px' }}>
          <path d="M22 36h8" stroke="var(--ink-2)" strokeWidth="1.8" strokeLinecap="round" />
        </g>
        <circle cx="22" cy="36" r="1.6" fill="var(--ink-2)" />
      </svg>
      <span aria-hidden="true" className="relative h-[66px] w-[168px]">
        <span className={`${slim} top-1 bg-surface inset-ring inset-ring-hairline-strong`} />
        <span className={`${slim} top-5 bg-surface inset-ring inset-ring-hairline-strong motion-safe:[animation-delay:0.6s]`} />
        <span className={`${slim} top-9 bg-honey-soft inset-ring inset-ring-honey/50 motion-safe:[animation-delay:1.2s]`} />
        <NotificationCard title="3 things need you" detail="13:30 roundup" className="absolute top-3 left-0 w-[168px] motion-safe:animate-interrupt-roundup" />
      </span>
    </span>
  );
}

/** As soon as it matters: one notification slides in. */
function AsapArt() {
  return (
    <span aria-hidden="true">
      <NotificationCard title="alice asked you a question" detail="acme/app #412 · Move CI to Depot" className="w-[200px] motion-safe:animate-interrupt-banner" />
    </span>
  );
}

/** The illustration area at the top of a "Your day" card. */
export function InterruptionsArt(props: { mode: InterruptionsMode }) {
  return (
    <span className="flex h-[92px] items-center justify-center overflow-hidden rounded-lg bg-done">
      {props.mode === 'never' && <NeverArt />}
      {props.mode === 'batches' && <BatchesArt />}
      {props.mode === 'asap' && <AsapArt />}
    </span>
  );
}
