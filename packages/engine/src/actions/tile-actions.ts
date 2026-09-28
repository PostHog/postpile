import { isPinged, threadPrKey, type ActionResult, type PrKey, type SnoozeCondition, type Tile } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import type { ActionLog } from '../writes/action-log.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok, readMessage } from './results.ts';

export class TileActions {
  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly log: ActionLog,
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
    const pinged = tile.members.filter((m) => isPinged(m.provenance)).map((m) => m.prKey);
    const batch = this.readMarker.markRead(keys, pinged, { origin: 'tile', tileId });
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

  /**
   * "Bring back" from the debug view. GitHub has no mark-unread, so this only
   * resets the app's own state: the PR is not handled any more, its tiles
   * read as unread ("brought back by you") until the next mark-read, and a
   * snooze on them ends. Nothing is sent to GitHub.
   */
  bringBack(key: PrKey): ActionResult {
    if (!this.store.prs.get(key)) {
      return failed(`${key} is not in the store, so it has no tile to bring back`);
    }
    const tileIds = this.tileIdsHolding(key);
    this.store.transaction(() => {
      this.store.userPrStates.markBroughtBack(key, this.now().toISOString());
      for (const tileId of tileIds) {
        this.store.snoozes.remove(tileId);
      }
    });
    this.log.record({
      action: 'bring_back',
      origin: 'debug',
      outcome: 'local',
      prKey: key,
      threadId: this.store.notifications.getByPrKey(key)?.id ?? null,
      tileId: tileIds[0] ?? null,
      detail: 'unread again in the app; GitHub unchanged (no mark-unread API)',
    });
    return ok('Brought back: the tile is unread again here. GitHub is unchanged.');
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
