import { useEffect, useRef } from 'react';
import type { PrKey } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { opensMarkRead, OpenedReadTimer, type OpenedTileView } from './opened-read.ts';

/**
 * Marks the PR in the detail pane read on GitHub (and handled in PostPile)
 * once the user moves on from it, when it stayed open for
 * OPENED_READ_DELAY_MS while the window was visible and `opensMarkRead`
 * says so ("Marked when you move on", 2026-09-29). Moving on: another PR or
 * tile, the pane closed (`prKey` changes or goes null), or the window
 * hidden or blurred. Once per open (`OpenedReadTimer`): re-renders and
 * refetches of the same PR ask nothing more, and opening the PR again later
 * asks again (the server turns that into a no-op once it is done).
 */
export function useOpenedRead(view: OpenedTileView | null, prKey: PrKey | null): void {
  const actions = useActions();
  const wanted = opensMarkRead(view, prKey, actions.writes);
  // The provider hands out a new function on every render; the timer calls the latest one.
  const markOpenedRead = useRef(actions.markOpenedRead);
  markOpenedRead.current = actions.markOpenedRead;
  const timer = useRef<OpenedReadTimer | null>(null);

  useEffect(() => {
    if (prKey === null) {
      return;
    }
    const open = new OpenedReadTimer(() => void markOpenedRead.current(prKey), window);
    timer.current = open;
    const onVisibility = () => (document.visibilityState === 'visible' && document.hasFocus() ? open.visible() : open.hidden());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
      window.removeEventListener('focus', onVisibility);
      // Moving on (another PR, the pane closed): runs before the next open's
      // effects, so the timer still has this PR's `wanted`.
      open.leave();
      timer.current = null;
    };
  }, [prKey]);

  // Declared after the open's effect: on a PR change the old open leaves first, then the new one gets its flag.
  useEffect(() => {
    timer.current?.setWanted(wanted);
  }, [wanted, prKey]);
}
