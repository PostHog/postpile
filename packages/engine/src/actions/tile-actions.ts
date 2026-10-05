import {
  isTracked,
  prReadScope,
  snoozeWrites,
  threadPrKey,
  tileReadScope,
  tilesReadScope,
  type ActionResult,
  type PendingThread,
  type PrKey,
  type Snooze,
  type SnoozeCondition,
  type SnoozeWrites,
  type Tile,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import type { PendingBatch } from '../mark-read-queue.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, muteMessage, ok, readMessage, unmuteMessage } from './results.ts';

/** What a mute or unmute replaced, kept by its undo token: Undo removes `remove` and puts `restore` back. */
interface SnoozeUndo {
  remove: PrKey[];
  restore: Snooze[];
}

export class TileActions {
  /** In memory, like the queue's batches: once a window ends there is nothing left to undo. */
  private readonly snoozeUndos = new Map<string, SnoozeUndo>();

  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
  ) {}

  /** On the hot Board, or in a topic whose older PRs went cold (`Board.forTile`): the topic pane shows those tiles too. */
  private findTile(tileId: string): Tile | null {
    return Board.forTile(this.store, this.now().toISOString(), tileId).findTile(tileId);
  }

  private tileIdsHolding(key: PrKey): string[] {
    const board = Board.forPr(this.store, this.now().toISOString(), key);
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
    const batch = this.readMarker.markRead(tileReadScope(tile), { kind: 'button' }, { origin: 'tile', tileId });
    return ok(readMessage('Marked read', batch), batch.token);
  }

  /**
   * The agent's Mark read over several tiles: one batch, so one undo token
   * brings every tile back. Unknown tile ids refuse the whole batch.
   */
  markTilesRead(tileIds: string[]): ActionResult {
    const tiles: Tile[] = [];
    for (const tileId of tileIds) {
      const tile = this.findTile(tileId);
      if (!tile) {
        return failed(`no tile ${tileId}`);
      }
      tiles.push(tile);
    }
    if (tiles.length === 0) {
      return failed('no tiles to mark read');
    }
    const tileId = tiles.length === 1 ? (tiles[0]?.id ?? null) : null;
    const batch = this.readMarker.markRead(tilesReadScope(tiles), { kind: 'button' }, { origin: 'tile', tileId });
    const base = tiles.length === 1 ? 'Marked read' : `Marked ${tiles.length} tiles read`;
    return ok(readMessage(base, batch), batch.token);
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
    const scope = prReadScope(key, isTracked(member.provenance));
    const batch = this.readMarker.markRead(scope, { kind: 'button' }, { origin: 'detail', tileId });
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

  /** Writes a snooze change for every PR of a tile at once. */
  private applySnoozeWrites(writes: SnoozeWrites): void {
    this.store.transaction(() => {
      writes.remove.forEach((key) => this.store.snoozes.remove(key));
      writes.put.forEach((snooze) => this.store.snoozes.put(snooze));
    });
  }

  /** A mute's or unmute's undo puts the snoozes back as they were. */
  private putBackSnoozes(token: string): void {
    const entry = this.snoozeUndos.get(token);
    if (!entry) {
      return;
    }
    this.snoozeUndos.delete(token);
    this.applySnoozeWrites({ put: entry.restore, remove: entry.remove });
  }

  undo(token: string | null): ActionResult {
    const batch = this.readMarker.undo(token);
    if (!batch) {
      if (token !== null) {
        this.snoozeUndos.delete(token);
      }
      return failed('Nothing to undo: already sent to GitHub');
    }
    this.putBackSnoozes(batch.token);
    return ok('Undone');
  }

  /** Keeps what a mute or unmute replaced while its batch can be undone; entries whose window ended go on the way. */
  private keepForUndo(batch: PendingBatch, remove: PrKey[], restore: Snooze[]): void {
    for (const token of this.snoozeUndos.keys()) {
      if (!this.readMarker.canUndo(token)) {
        this.snoozeUndos.delete(token);
      }
    }
    this.snoozeUndos.set(batch.token, { remove, restore });
  }

  /** The notification threads of these PRs, read or unread: a mute unsubscribes from each, an unmute subscribes again. */
  private threadsOf(keys: PrKey[]): PendingThread[] {
    return [...this.store.notifications.getByPrKeys(keys).entries()].map(([key, thread]) => ({ id: thread.id, updatedAt: thread.updatedAt, prKey: key }));
  }

  /**
   * "Mute until I'm mentioned" (2026-10-05): the tile's tracked PRs get a
   * mute (`muted` snooze, only a personal ask ends it), the tile is marked
   * read like the other clears, and GitHub unsubscribes the viewer from each
   * thread after the undo window, or later as a pending write while locked.
   * Undo takes all of it back.
   */
  private mute(tile: Tile): ActionResult {
    const writes = snoozeWrites(tile, { kind: 'start', condition: { kind: 'muted' }, at: this.now().toISOString() });
    if (writes.put.length === 0) {
      return failed(`nothing to mute in tile ${tile.id}`);
    }
    const keys = writes.put.map((snooze) => snooze.prKey);
    const before = keys.flatMap((key) => this.store.snoozes.get(key) ?? []);
    this.applySnoozeWrites(writes);
    const threads = this.threadsOf(keys);
    const subscription = threads.length > 0 ? { subscribed: false, threads } : null;
    const batch = this.readMarker.markRead(tileReadScope(tile), { kind: 'button' }, { origin: 'tile', tileId: tile.id }, subscription);
    this.keepForUndo(batch, keys, before);
    return ok(muteMessage(batch), batch.token);
  }

  /** Snoozes each tracked PR of the tile with the same condition (see `snoozeWrites`); a mute does more (`mute`). */
  snooze(tileId: string, condition: SnoozeCondition): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    if (condition.kind === 'muted') {
      return this.mute(tile);
    }
    const writes = snoozeWrites(tile, { kind: 'start', condition, at: this.now().toISOString() });
    if (writes.put.length === 0) {
      return failed(`nothing to snooze in tile ${tileId}`);
    }
    this.applySnoozeWrites(writes);
    return ok('Snoozed');
  }

  /**
   * Takes the tile's snooze back. Unmute also subscribes the viewer to the
   * muted PRs' threads again (2026-10-05): without that GitHub stays quiet
   * about them, so new activity would never turn the tile unread. It goes
   * to GitHub after the undo window, or as a pending write while locked.
   */
  unsnooze(tileId: string): ActionResult {
    const tile = this.findTile(tileId);
    if (!tile) {
      return failed(`no tile ${tileId}`);
    }
    const snoozes = tile.members.flatMap((member) => this.store.snoozes.get(member.prKey) ?? []);
    this.applySnoozeWrites(snoozeWrites(tile, { kind: 'end' }));
    const mutedKeys = snoozes.filter((snooze) => snooze.condition.kind === 'muted').map((snooze) => snooze.prKey);
    if (mutedKeys.length === 0) {
      return ok('Unsnoozed');
    }
    const threads = this.threadsOf(mutedKeys);
    if (threads.length === 0) {
      return ok('Unmuted');
    }
    const batch = this.readMarker.changeSubscription({ subscribed: true, threads }, { origin: 'tile', tileId });
    this.keepForUndo(batch, [], snoozes);
    return ok(unmuteMessage(batch), batch.token);
  }
}
