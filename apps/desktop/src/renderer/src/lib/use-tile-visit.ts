import { useEffect } from 'react';
import type { TileView } from '@postpile/core';

/**
 * Tells the desktop app which tile the user opened, so its Mac pings leave
 * Notification Center (2026-10-01). Main does the matching by PR key; this
 * only says what is open. The caller passes the user's pick (a click on the
 * tile or one of its PRs, a ping click), not a tile the app picked on its
 * own: that one can change while nobody looks.
 */
export function useTileVisit(view: TileView | null): void {
  const prKeys = view ? view.prs.map((pr) => pr.key).join(' ') : '';
  useEffect(() => {
    if (prKeys !== '') {
      window.postpile?.tileVisited?.(prKeys.split(' '));
    }
  }, [prKeys]);
}
