import { isPinged, type ActionResult, type SnoozeCondition, type Tile } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { Board } from '../board.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok } from './results.ts';

export class TileActions {
  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
  ) {}

  private findTile(tileId: string): Tile | null {
    return Board.load(this.store, this.now().toISOString()).findTile(tileId);
  }

  /**
   * Every member's events become seen. Pinged members count as handled, so
   * the tile turns done until something loud happens again.
   */
  markRead(tileId: string): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    const keys = tile.members.map((m) => m.prKey);
    const pinged = tile.members.filter((m) => isPinged(m.provenance)).map((m) => m.prKey);
    return ok('Marked read', this.readMarker.markRead(keys, pinged));
  }

  undo(token: string | null): ActionResult {
    const batch = this.readMarker.undo(token);
    if (!batch) {
      return failed('Nothing to undo: already sent to GitHub');
    }
    return ok('Undone');
  }

  snooze(tileId: string, condition: SnoozeCondition): ActionResult {
    if (!this.findTile(tileId)) {
      return failed(`no tile ${tileId}`);
    }
    this.store.snoozes.put({ tileId, condition, since: this.now().toISOString() });
    return ok('Snoozed');
  }

  unsnooze(tileId: string): ActionResult {
    this.store.snoozes.remove(tileId);
    return ok('Unsnoozed');
  }
}
