import { useEffect, useRef } from 'react';
import type { PrDetail, PrKey } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { GlanceLookTimer, wantsGlanceRefresh } from './glance-look.ts';

/**
 * Asks the server for a new glance when the PR in the detail pane stays
 * open GLANCE_LOOK_DELAY_MS while the window is visible and its glance is
 * stale (`wantsGlanceRefresh`). Once per open (`GlanceLookTimer`):
 * re-renders and refetches of the same PR ask nothing more; opening it
 * again later asks again (the server makes that a no-op when nothing is due).
 * The glance card then says "Updating now" from the server's glanceState.
 */
export function useGlanceLook(prKey: PrKey | null, detail: PrDetail | null): void {
  const actions = useActions();
  // The detail can still be the previous PR's while the new one loads.
  const wanted = detail !== null && detail.pr.key === prKey && wantsGlanceRefresh(detail);
  // The provider hands out a new function on every render; the timer calls the latest one.
  const refresh = useRef(actions.refreshGlanceOnLook);
  refresh.current = actions.refreshGlanceOnLook;
  const timer = useRef<GlanceLookTimer | null>(null);

  useEffect(() => {
    if (prKey === null) {
      return;
    }
    const open = new GlanceLookTimer(() => void refresh.current(prKey), window);
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
      open.leave();
      timer.current = null;
    };
  }, [prKey]);

  // Declared after the open's effect: on a PR change the new timer exists before it gets its flag.
  useEffect(() => {
    timer.current?.setWanted(wanted);
  }, [wanted, prKey]);
}
