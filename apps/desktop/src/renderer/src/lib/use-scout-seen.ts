import { useEffect, useRef } from 'react';
import type { TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { scoutSeenTarget } from './scouts.ts';

/**
 * Marks a scouted PR seen in PostPile when the user opens it (DESIGN.md
 * "Scouts"): local only, never a GitHub read. Like the opened-read dwell,
 * `prKey` is the user's own pick (`dwellPrKey`), so a tile the app picked
 * on its own marks nothing. Once per open: `openId` grows with every
 * explicit open, and the ref keeps StrictMode's second effect run (and
 * refetches of the same open) from asking twice.
 */
export function useScoutSeen(view: TileView | null, prKey: string | null, openId: number): void {
  const { markScoutedSeen } = useActions();
  const target = scoutSeenTarget(view, prKey);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (target === null) {
      return;
    }
    const key = `${target}|${openId}`;
    if (asked.current === key) {
      return;
    }
    asked.current = key;
    void markScoutedSeen(target);
    // markScoutedSeen is new on every render; only a new target or open matters.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [target, openId]);
}
