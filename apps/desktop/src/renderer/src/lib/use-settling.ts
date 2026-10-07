import { useEffect, useState } from 'react';
import { reducedMotion } from './motion.ts';

/**
 * How long a settle runs: the last step (the sheen over "Archive now")
 * starts at +960ms and takes 700ms.
 */
export const SETTLE_MS = 1700;

/**
 * True for SETTLE_MS after `settled` turned true while the component was on
 * screen, the cue for the staged settle after a read lands (DESIGN.md
 * "Marked when the dwell ends", 2026-10-07). Never on the first render, so
 * opening a topic that is read already shows it as it is. A new `resetKey`
 * (another topic in the same component) starts over without a settle.
 * Always false with reduced motion: everything lands at once.
 */
export function useSettling(settled: boolean, resetKey = ''): boolean {
  const [seen, setSeen] = useState({ settled, resetKey });
  const [settling, setSettling] = useState(false);
  if (seen.settled !== settled || seen.resetKey !== resetKey) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    setSeen({ settled, resetKey });
    setSettling(seen.resetKey === resetKey && settled && !reducedMotion());
  }
  useEffect(() => {
    if (!settling) {
      return;
    }
    const timer = window.setTimeout(() => setSettling(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settling]);
  return settling;
}
