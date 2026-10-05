import type { PaneOffers, PrKey, TileView } from '@postpile/core';

/** Only Open, for a PR the tile has no row for (it left the tile since the pane opened). */
const ONLY_OPEN: PaneOffers = {
  scope: 'tile',
  lead: 'open_on_github',
  approve: false,
  open: true,
  ask: false,
  markLabel: null,
  snooze: false,
  removeTeams: [],
  pendingWrite: null,
};

/** The detail pane's offers for one PR from core (`TileView.offers.pane`), or only Open when the tile has no row for it. */
export function paneOffersFor(view: TileView, prKey: PrKey): PaneOffers {
  return view.offers.pane[prKey] ?? ONLY_OPEN;
}
