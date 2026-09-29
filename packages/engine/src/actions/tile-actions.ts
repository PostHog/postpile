import { isTracked, snoozeWrites, threadPrKey, type ActionResult, type PrKey, type SnoozeCondition, type SnoozeWrites, type Tile } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok, readMessage } from './results.ts';

export class TileActions {
  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
  ) {}

  private findTile(tileId: string): Tile | null {
    return Board.load(this.store, this.now().toISOString()).findTile(tileId);
  }

  private tileIdsHolding(key: PrKey): string[] {
    const board = Board.load(this.store, this.now().toISOString());
    return board
      .topics()
      .flatMap((topic) => board.tilesForTopic(topic.id))
      .filter((tile) => tile.members.some((member) => member.prKey === key))
      .map((tile) => tile.id);
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
    const pinged = tile.members.filter((m) => isTracked(m.provenance)).map((m) => m.prKey);
    const batch = this.readMarker.markRead(keys, pinged, { origin: 'tile', tileId });
    return ok(readMessage('Marked read', batch), batch.token);
  }

  /**
   * Mark read / Mark done in the detail pane: the selected PR only
   * (2026-09-29). Its events become seen and, when the tile tracks it (not a
   * pulled-in stack layer), it counts as handled. Its own batch, so undo
   * brings back that PR only.
   */
  markPrRead(tileId: string, key: PrKey): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    const member = tile.members.find((candidate) => candidate.prKey === key);
    if (!member) {
      return failed(`${key} is not in tile ${tileId}`);
    }
    const handle = isTracked(member.provenance) ? [key] : [];
    const batch = this.readMarker.markRead([key], handle, { origin: 'detail', tileId });
    return ok(readMessage('Marked read', batch), batch.token);
  }

  /** "Mark read" in the notifications debug view, by thread. Same queue and undo as a tile. */
  markThreadRead(threadId: string): ActionResult {
    const thread = this.store.notifications.get(threadId);
    if (!thread) {
      return failed(`no notification thread ${threadId}`);
    }
    const key = threadPrKey(thread);
    const tileId = key === null ? null : (this.tileIdsHolding(key)[0] ?? null);
    const batch = this.readMarker.markThread(thread, { origin: 'debug', tileId });
    return ok(readMessage('Marked read', batch), batch.token);
  }

  undo(token: string | null): ActionResult {
    const batch = this.readMarker.undo(token);
    if (!batch) {
      return failed('Nothing to undo: already sent to GitHub');
    }
    return ok('Undone');
  }

  /** Writes a snooze change for every PR of a tile at once. */
  private applySnoozeWrites(writes: SnoozeWrites): void {
    this.store.transaction(() => {
      writes.remove.forEach((key) => this.store.snoozes.remove(key));
      writes.put.forEach((snooze) => this.store.snoozes.put(snooze));
    });
  }

  /** Snoozes each tracked PR of the tile with the same condition (see `snoozeWrites`). */
  snooze(tileId: string, condition: SnoozeCondition): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    const writes = snoozeWrites(tile, { kind: 'start', condition, at: this.now().toISOString() });
    if (writes.put.length === 0) {
      return failed(`nothing to snooze in tile ${tileId}`);
    }
    this.applySnoozeWrites(writes);
    return ok('Snoozed');
  }

  unsnooze(tileId: string): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    this.applySnoozeWrites(snoozeWrites(tile, { kind: 'end' }));
    return ok('Unsnoozed');
  }
}
