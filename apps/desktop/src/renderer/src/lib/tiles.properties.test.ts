// The "Not done yet" dots over generated boards (core testing/): the dots
// name exactly the PRs that keep a live multi-PR tile from being done.
import { checkBoards, ensure, PROPERTY_TIMEOUT_MS, trackedRows, type Invariant } from '@postpile/core/testing';
import { describe, it } from 'vitest';
import { notDonePrKeys } from './tiles.ts';

/** One dot per tracked PR that is not done or has unseen news, only on unread or open tiles with more than one tracked PR. */
const oneDotPerNotDonePr: Invariant = {
  name: 'one Not done yet dot per not-done PR, only on live multi-PR tiles',
  check(_board, views) {
    for (const view of views) {
      const dots = [...notDonePrKeys(view)].sort();
      const tracked = trackedRows(view);
      const live = view.state.kind === 'unread' || view.state.kind === 'open';
      if (!live || tracked.length <= 1) {
        ensure(dots.length === 0, `${view.tile.id}: dots on a ${view.state.kind} tile with ${tracked.length} tracked PRs`);
        continue;
      }
      const expected = tracked.filter((row) => !row.done || row.unseenLoudEvents > 0).map((row) => row.key).sort();
      ensure(JSON.stringify(dots) === JSON.stringify(expected), `${view.tile.id}: dots ${dots.join(', ')}, not done ${expected.join(', ')}`);
    }
  },
};

/**
 * "No dots left, the tile is done": a live multi-PR tile always dots the PR
 * that holds it. Except on purpose (open question for Julian): loud news on
 * a pulled-in stack layer makes the tile unread (DESIGN "Open questions"),
 * but a pulled-in layer never gets a dot, so such a tile can be unread with
 * every dot gone.
 */
const liveTileShowsWhatHoldsIt: Invariant = {
  name: 'a live multi-PR tile dots at least one PR, unless only a pulled-in layer has news',
  check(_board, views) {
    for (const view of views) {
      const live = view.state.kind === 'unread' || view.state.kind === 'open';
      const pulledInNewsOnly =
        view.state.kind === 'unread' &&
        view.state.unreadBecause.every((reason) => view.prs.find((row) => row.key === reason.prKey)?.provenance.kind === 'pulled_in');
      if (live && !pulledInNewsOnly && trackedRows(view).length > 1) {
        ensure(notDonePrKeys(view).size > 0, `${view.tile.id}: ${view.state.kind} tile without a dot`);
      }
    }
  },
};

describe('Not done yet dots', () => {
  for (const invariant of [oneDotPerNotDonePr, liveTileShowsWhatHoldsIt]) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});
