import { useEffect, useRef } from 'react';
import type { PrKey } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { OPENED_READ_DELAY_MS, opensMarkRead, type OpenedTileView } from './opened-read.ts';

/**
 * Marks the PR in the detail pane read on GitHub once it stayed open for
 * OPENED_READ_DELAY_MS while the window is visible, when `opensMarkRead`
 * says so. Once per open: re-renders and refetches of the same PR ask
 * nothing more; opening it again later asks again (the server turns that
 * into a no-op once the thread is read).
 */
export function useOpenedRead(view: OpenedTileView | null, prKey: PrKey | null): void {
  const actions = useActions();
  const wanted = opensMarkRead(view, prKey, actions.writes);
  const askedFor = useRef<PrKey | null>(null);
  const markOpenedRead = actions.markOpenedRead;
  useEffect(() => {
    if (prKey !== askedFor.current) {
      askedFor.current = null;
    }
    if (!wanted || prKey === null || askedFor.current === prKey) {
      return;
    }
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      askedFor.current = prKey;
      void markOpenedRead(prKey);
    }, OPENED_READ_DELAY_MS);
    return () => clearTimeout(timer);
    // markOpenedRead is a new function on every render of the provider; the open is keyed by the PR.
  }, [wanted, prKey]);
}
