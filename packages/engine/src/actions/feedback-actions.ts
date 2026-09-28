import { isTracked, setIdFromTileId, type ActionResult, type FeedbackInput, type PrKey, type Tile } from '@postpile/core';
import type { NewFeedback, Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { prKeyOfEvent } from '../ids.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok, readMessage } from './results.ts';
import type { PendingBatch } from '../mark-read-queue.ts';

/**
 * User corrections. Each one is logged (the newest go back into prompts) and
 * applied right away where there is something to apply.
 */
export class FeedbackActions {
  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
  ) {}

  private realTopicId(topicId: string | null): string | null {
    return topicId === UNSORTED_TOPIC_ID ? null : topicId;
  }

  private log(entry: Omit<NewFeedback, 'createdAt'>): void {
    this.store.feedback.add({ ...entry, createdAt: this.now().toISOString() });
  }

  /**
   * "Not mine" acts like mark read: events seen, pinged PRs handled, the GitHub
   * notification read after the undo window. Returns the batch (token = undo token). The
   * agent learns from the logged note.
   */
  private notMine(tile: Tile, key: PrKey | null): PendingBatch {
    const origin = { origin: 'tile' as const, tileId: tile.id };
    if (key) {
      return this.readMarker.markRead([key], [key], origin);
    }
    const keys = tile.members.map((m) => m.prKey);
    const pinged = tile.members.filter((m) => isTracked(m.provenance)).map((m) => m.prKey);
    return this.readMarker.markRead(keys, pinged, origin);
  }

  /**
   * "Wrong topic": move it when the user said where, otherwise let the next
   * sync re-sort it. A stack moves as one: every layer with a topic or a
   * thread goes along (`keys`), pulled-in layers follow on their own.
   */
  private wrongTopic(keys: PrKey[], targetTopicId: string | null, note: string): ActionResult {
    if (targetTopicId !== null) {
      const target = this.store.topics.get(targetTopicId);
      if (!target) {
        return failed(`no topic ${targetTopicId}`);
      }
      if (target.status === 'retired') {
        this.store.topics.setStatus(targetTopicId, 'active', this.now().toISOString());
      }
      for (const key of keys) {
        this.store.memberships.assign({
          prKey: key,
          topicId: targetTopicId,
          assignedBy: 'user',
          reason: note || 'moved by the user',
          createdAt: this.now().toISOString(),
        });
      }
      return ok('Moved');
    }
    keys.forEach((key) => this.store.memberships.remove(key));
    return ok('Will be re-sorted on the next sync');
  }

  giveFeedback(input: FeedbackInput): ActionResult {
    const board = Board.load(this.store, this.now().toISOString());
    const tile = board.findTile(input.tileId);
    if (!tile) {
      return failed(`no tile ${input.tileId}`);
    }
    const key = input.prKey ?? (tile.members.length === 1 ? tile.members[0]!.prKey : null);
    const setId = setIdFromTileId(input.tileId);
    const topicId = this.realTopicId(key ? board.topicIdOf(key) : tile.topicId);

    return this.store.transaction(() => {
      // Glances only pick up feedback about their own PR, so "not mine" on a
      // whole stack or set is logged once per member.
      const aboutKeys = !key && input.kind === 'not_mine' ? tile.members.map((m) => m.prKey) : [key];
      for (const about of aboutKeys) {
        this.log({ kind: input.kind, topicId, tileId: input.tileId, prKey: about, setId, eventId: null, note: input.note });
      }
      if (input.kind === 'not_mine') {
        const batch = this.notMine(tile, key);
        return ok(readMessage('Noted: not yours, marked read', batch), batch.token);
      }
      if (input.kind === 'not_related') {
        if (!setId || !key) {
          return failed('"Not related" needs a set tile and the PR to drop');
        }
        // A stack leaves a set whole, like it joined it.
        for (const layer of board.stackKeysOf(key)) {
          this.store.sets.removeMember(setId, layer, this.now().toISOString());
        }
        return ok('Removed from the set');
      }
      if (!key) {
        return failed('"Wrong topic" needs the PR');
      }
      return this.wrongTopic(board.movesWith(key), input.targetTopicId, input.note);
    });
  }

  unmuteEvent(eventId: string): ActionResult {
    const key = prKeyOfEvent(eventId);
    const event = this.store.events.listForPr(key).find((e) => e.id === eventId);
    if (!event) {
      return failed(`no event ${eventId}`);
    }
    const loudness = event.ruleLoudness === 'muted' ? 'quiet' : event.ruleLoudness;
    this.store.transaction(() => {
      this.store.events.setOverride(eventId, { loudness, reason: 'unmuted by the user', by: 'user' });
      const topicId = this.store.memberships.get(key)?.topicId ?? null;
      this.log({ kind: 'unmute', topicId, tileId: null, prKey: key, setId: null, eventId, note: event.summary });
    });
    return ok('Unmuted');
  }
}
