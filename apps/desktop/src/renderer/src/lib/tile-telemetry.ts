import type { TelemetryEventProps, TileView, Verdict } from '@postpile/core';
import { leadPr } from './tiles.ts';

type TileOpenedProps = TelemetryEventProps<'tile_opened'>;

const FOR_WHOM: Record<TileView['forWhom']['kind'], TileOpenedProps['for_whom']> = {
  you: 'you',
  team: 'team',
  routing: 'routing',
  own: 'your_pr',
  none: 'none',
};

const VERDICT: Record<Verdict, TileOpenedProps['verdict']> = {
  LOOKS_SAFE: 'looks_safe',
  LOOK_CLOSER: 'look_closer',
  NOT_YOURS: 'not_yours',
};

/** For tile_opened: the tile's own kind and for-whom chip, plus the lead PR's glance (if any). */
export function tileOpenedProps(view: TileView): TileOpenedProps {
  const pr = leadPr(view);
  const verdict = pr?.verdict ?? null;
  return {
    tile_kind: view.tile.kind,
    for_whom: FOR_WHOM[view.forWhom.kind],
    has_glance: pr?.forYou !== null && pr?.forYou !== undefined,
    verdict: verdict ? VERDICT[verdict] : null,
  };
}
