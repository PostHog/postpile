// The Scouts searchlight (design canvas "Scout icons", option E): a lamp on
// your inbox list sweeps the dark around it, and one PR out there lights up
// honey. Colors come from tokens; the keyframes are the scout-* ones in
// app.css. It moves only under motion-safe:, so with Reduce Motion the beam
// rests and the found PR simply shows lit.

/** Card size, 108x72: the sweeping beam and the PR it lights. */
function CardSearchlight() {
  return (
    <svg viewBox="0 0 96 64" width="108" height="72" aria-hidden="true" className="shrink-0">
      <rect x="0" y="0" width="96" height="64" rx="10" fill="var(--ink-2)" />
      {/* The beam turns around the lamp, in the svg's own coordinates. */}
      <g className="[transform-box:view-box] motion-safe:animate-scout-beam" style={{ transformOrigin: '30px 32px' }}>
        <path d="M30 32L96 14L96 50Z" fill="var(--honey-soft)" fillOpacity="0.55" />
      </g>
      <rect x="6" y="18" width="24" height="34" rx="4" fill="var(--bg-surface)" stroke="var(--ghost)" />
      <rect x="10" y="24" width="16" height="5" rx="2" fill="var(--bg-chip)" />
      <rect x="10" y="33" width="16" height="5" rx="2" fill="var(--bg-chip)" />
      <rect x="10" y="42" width="16" height="5" rx="2" fill="var(--bg-chip)" />
      <rect x="24" y="27" width="10" height="10" rx="3" fill="var(--ink)" />
      <rect x="60" y="20" width="20" height="13" rx="3" fill="var(--muted)" fillOpacity="0.5" />
      <rect x="62" y="40" width="22" height="13" rx="3" fill="var(--muted)" fillOpacity="0.5" />
      <g className="motion-safe:animate-scout-lit">
        <rect x="62" y="40" width="22" height="13" rx="3" fill="var(--honey-soft)" stroke="var(--honey)" strokeWidth="1.4" />
        <rect x="66" y="45" width="11" height="3" rx="1.5" fill="var(--honey-ink)" fillOpacity="0.4" />
      </g>
    </svg>
  );
}

/** Sidebar size, 14px and still: the list, its lamp and the beam. */
function SidebarSearchlight() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
      <rect x="2" y="7" width="7" height="12" rx="1.6" fill="var(--bg-surface)" stroke="var(--ghost)" strokeWidth="1.4" />
      <rect x="7" y="10" width="4" height="4" rx="1" fill="var(--ink)" />
      <path d="M11 12L23 6L23 18Z" fill="var(--honey)" fillOpacity="0.7" />
    </svg>
  );
}

/** The searchlight: `card` on the intro card, `sidebar` on the Scouted section's header. */
export function ScoutIntroArt(props: { size: 'card' | 'sidebar' }) {
  return props.size === 'card' ? <CardSearchlight /> : <SidebarSearchlight />;
}

/** The check screen's header: the robot with checked eyes and a found dot that pops in once. */
export function ScoutCheckedArt() {
  return (
    <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true" className="shrink-0">
      <path d="M32 22v-5" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="14" r="3" fill="var(--honey)" />
      <rect x="13" y="22" width="38" height="27" rx="9" fill="var(--bg-segment)" stroke="var(--ink-2)" strokeWidth="2.6" />
      <rect x="18" y="27" width="28" height="16" rx="6" fill="var(--bg-surface)" stroke="var(--ghost)" strokeWidth="1.2" />
      <path d="M23 34.5l2.5 2.5 4.5-5M34 34.5l2.5 2.5 4.5-5" fill="none" stroke="var(--safe)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <g className="origin-center [transform-box:fill-box] motion-safe:animate-scout-found">
        <circle cx="50" cy="16" r="6" fill="var(--honey)" stroke="var(--honey-ink)" strokeWidth="1.4" />
        <path d="M50 13v3.5M50 18.6v0.4" stroke="var(--honey-ink)" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
