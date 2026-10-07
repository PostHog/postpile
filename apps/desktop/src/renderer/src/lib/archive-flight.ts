// "Archive now" shows where the topic went (DESIGN.md "The Archive",
// 2026-10-07): a copy of its sidebar row lifts off and flies into the
// Archive fold, shrinking and fading on the way, and the fold tints briefly
// as it lands. The row itself stays in the list, hidden, while its space
// closes (`.topic-row-leaving` in app.css). DOM only, run once per archive.

/** The flight, from lift-off to landing; the leaving row is kept this long. */
export const ARCHIVE_FLIGHT_MS = 560;
const FLIGHT_EASING = 'cubic-bezier(.4,0,.2,1)';
/** The fold's tint starts as the copy reaches it: ~300ms in, ~900ms out. */
const TINT_DELAY_MS = 480;
const TINT_MS = 1200;

/** A copy of the row, fixed over the row's own place, outside the list so it can fly over everything. */
function liftOff(row: HTMLElement): HTMLElement {
  const place = row.getBoundingClientRect();
  const copy = row.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-flip-key');
  copy.removeAttribute('data-flip-group');
  copy.setAttribute('aria-hidden', 'true');
  copy.tabIndex = -1;
  copy.style.position = 'fixed';
  copy.style.left = `${place.left}px`;
  copy.style.top = `${place.top}px`;
  copy.style.width = `${place.width}px`;
  copy.style.height = `${place.height}px`;
  copy.style.margin = '0';
  copy.style.zIndex = '50';
  copy.style.pointerEvents = 'none';
  document.body.appendChild(copy);
  return copy;
}

/**
 * Flies a copy of `row` into `fold` (the Archive header) and tints the fold
 * as it lands. Without the fold the copy fades where it is. The caller
 * hides the row and skips this with reduced motion.
 */
export function flyToArchive(row: HTMLElement, fold: HTMLElement | null): void {
  if (typeof row.animate !== 'function') {
    return;
  }
  const from = row.getBoundingClientRect();
  const to = fold?.getBoundingClientRect() ?? from;
  const copy = liftOff(row);
  // Aim the row's centre a little into the fold's label, where it shrinks into.
  const dx = to.left - from.left + 8;
  const dy = to.top - from.top - (from.height - to.height) / 2;
  const flight = copy.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: 'translate(4px, -6px) scale(1.02)', opacity: 1, offset: 0.22 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0 },
    ],
    { duration: ARCHIVE_FLIGHT_MS, easing: FLIGHT_EASING, fill: 'forwards' },
  );
  flight.onfinish = () => copy.remove();
  flight.oncancel = () => copy.remove();
  if (fold === null) {
    return;
  }
  const tint = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
  // No start or end colour: it comes from and goes back to the fold's own background.
  fold.animate([{ backgroundColor: tint, offset: 0.25 }], { duration: TINT_MS, delay: TINT_DELAY_MS, easing: 'ease' });
}
