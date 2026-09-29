import { useEffect, useRef } from 'react';
import type { PrKey } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { opensMarkRead, OpenedReadTimer, type OpenedTileView } from './opened-read.ts';

/**
 * Marks the PR in the detail pane read on GitHub once it stayed open for
 * OPENED_READ_DELAY_MS while the window is visible, when `opensMarkRead`
 * says so. Once per open (`OpenedReadTimer`): re-renders and refetches of
 * the same PR ask nothing more, hiding the window restarts the wait, and
 * opening the PR again later asks again (the server turns that into a
 * no-op once the thread is read).
 */
export function useOpenedRead(view: OpenedTileView | null, prKey: PrKey | null): void {
  const actions = useActions();
  const wanted = opensMarkRead(view, prKey, actions.writes);
  // The provider hands out a new function on every render; the timer calls the latest one.
  const markOpenedRead = useRef(actions.markOpenedRead);
  markOpenedRead.current = actions.markOpenedRead;
  const open = useRef<{ prKey: PrKey; timer: OpenedReadTimer } | null>(null);
  useEffect(() => {
    if (!wanted || prKey === null) {
      return;
    }
    if (open.current?.prKey !== prKey) {
      open.current = { prKey, timer: new OpenedReadTimer(() => void markOpenedRead.current(prKey), window) };
    }
    const timer = open.current.timer;
    const onVisibility = () => (document.visibilityState === 'visible' ? timer.visible() : timer.hidden());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      timer.stop();
    };
  }, [wanted, prKey]);
}
