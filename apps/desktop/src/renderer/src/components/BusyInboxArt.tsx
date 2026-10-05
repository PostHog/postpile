// The aching robot of the busy inbox card: the agent, squinting and sweating
// a little under a big inbox. Drawn after the design canvas "Aching robot".
// Colors come from tokens (ink lines, the amber warning light, --drop for the
// sweat, the card's only blue); the keyframes are the busy-* ones in app.css.
// It moves only under motion-safe:, so with Reduce Motion it stands still:
// upright, light on, the drop at its start.

/** Card size, 40px: antenna with the blinking light, the head shaking now and then, squinting eyes, a wavy mouth and the sweat drop. */
function CardRobot() {
  return (
    <svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true" className="shrink-0">
      {/* The head turns around its chin, in the svg's own coordinates. */}
      <g className="[transform-box:view-box] motion-safe:animate-busy-shake" style={{ transformOrigin: '32px 46px' }}>
        <path d="M32 16v-3" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="32" cy="11" r="3" fill="var(--amber)" className="motion-safe:animate-busy-blink" />
        <rect x="12" y="16" width="40" height="31" rx="9" fill="var(--bg-segment)" stroke="var(--ink-2)" strokeWidth="2.4" />
        <rect x="17" y="22" width="30" height="19" rx="6" fill="var(--bg-surface)" stroke="var(--ghost)" strokeWidth="1.2" />
        <path d="M22 28l4.5 3-4.5 3M42 28l-4.5 3 4.5 3" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M27 37.5q1.25-1.4 2.5 0t2.5 0t2.5 0t2.5 0" fill="none" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" />
      </g>
      <path
        d="M56 17c0 0-3.6 4.6-3.6 7a3.6 3.6 0 0 0 7.2 0c0-2.4-3.6-7-3.6-7z"
        fill="var(--drop)"
        stroke="var(--drop-line)"
        strokeWidth="1.2"
        className="motion-safe:animate-busy-drip"
      />
    </svg>
  );
}

/** Line size, 20px, for the folded card: the head with squinting eyes and the drop. Still: folded means quiet. */
function LineRobot() {
  return (
    <svg viewBox="0 0 64 64" width="20" height="20" aria-hidden="true" className="shrink-0">
      <rect x="10" y="16" width="44" height="34" rx="10" fill="var(--bg-segment)" stroke="var(--ink-2)" strokeWidth="4.5" />
      <path d="M21 27l7 5-7 5M43 27l-7 5 7 5" fill="none" stroke="var(--ink)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M56 8c0 0-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9z" fill="var(--drop-line)" />
    </svg>
  );
}

/** The busy inbox robot: `card` on the open card, `line` on the folded one. */
export function BusyInboxArt(props: { size: 'card' | 'line' }) {
  return props.size === 'card' ? <CardRobot /> : <LineRobot />;
}
