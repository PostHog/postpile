import { buildStacks, prReadScope, setIdFromTileId, stackByPrKey, tileReadScope, type ActionResult, type FeedbackInput, type PrKey, type Tile } from '@postpile/core';
import type { NewFeedback, Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { prKeyOfEvent } from '../ids.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok, readMessage } from './results.ts';
import type { PendingBatch } from '../mark-read-queue.ts';
import { changeTopicStatus } from '../topic-status.ts';
import { setUnitCount } from '../digest/set-grouping.ts';

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
    const scope = key ? prReadScope(key, true) : tileReadScope(tile);
    return this.readMarker.markRead(scope, { kind: 'button' }, origin);
  }

  /**
   * Ends a set the user took a PR out of once it holds fewer than two units,
   * like an agent change: one stack and nothing else is just that stack.
   */
  private endSetIfTooSmall(setId: string, topicId: string, at: string): void {
    const left = this.store.sets.get(setId);
    if (left?.status === 'active' && setUnitCount(left.members, stackByPrKey(buildStacks(this.store.prs.listHeaders()))) < 2) {
      this.store.sets.dissolve(setId, at);
    }
    if (this.store.sets.get(setId)?.status === 'dissolved') {
      this.store.sets.recordChange({ setId, topicId, by: 'user', at, prKey: null, kind: 'ended', reason: 'fewer than two PRs left' });
    }
  }

  /**
   * Moved PRs leave the sets of every other topic right away, the way the
   * next set pass would ("moved to another topic"). Without this the old
   * topic's set tile kept showing them next to their new tile until then.
   */
  private leaveOtherSets(keys: PrKey[], targetTopicId: string | null): void {
    const at = this.now().toISOString();
    for (const key of keys) {
      for (const set of this.store.sets.listActiveForPr(key)) {
        if (set.topicId === targetTopicId) {
          continue;
        }
        this.store.sets.removeMember(set.id, key, at);
        this.store.sets.recordChange({ setId: set.id, topicId: set.topicId, by: 'user', at, prKey: key, kind: 'left', reason: 'moved to another topic' });
        this.endSetIfTooSmall(set.id, set.topicId, at);
      }
    }
  }

  /**
   * "Wrong topic": move it when the user said where, otherwise let the next
   * sync re-sort it. A stack moves as one: every layer with a topic or a
   * thread goes along (`keys`), pulled-in layers follow on their own. The
   * logged feedback keeps every moved layer out of the old topic for good
   * (`TopicExclusions`); a pick puts it where the user said, as theirs.
   * Either way the moved PRs leave the old topic's sets at once.
   */
  private wrongTopic(keys: PrKey[], targetTopicId: string | null, note: string): ActionResult {
    if (targetTopicId !== null) {
      const target = this.store.topics.get(targetTopicId);
      if (!target) {
        return failed(`no topic ${targetTopicId}`);
      }
      this.leaveOtherSets(keys, targetTopicId);
      changeTopicStatus(this.store, targetTopicId, 'revive', this.now().toISOString());
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
    this.leaveOtherSets(keys, null);
    keys.forEach((key) => this.store.memberships.remove(key));
    return ok('Will be re-sorted on the next sync');
  }

  /**
   * The PRs a correction is logged about. Glances only pick up feedback
   * about their own PR, so "not mine" on a whole stack or set is logged once
   * per member. "Wrong topic" is logged once per layer that moves, so each
   * one stays out of the topic it left, also when it is sorted alone later.
   */
  private aboutKeys(input: FeedbackInput, key: PrKey | null, tile: Tile, board: Board): Array<PrKey | null> {
    if (input.kind === 'not_mine' && !key) {
      return tile.members.map((m) => m.prKey);
    }
    if (input.kind === 'wrong_topic' && key) {
      return board.movesWith(key);
    }
    return [key];
  }

  giveFeedback(input: FeedbackInput): ActionResult {
    const board = Board.forTile(this.store, this.now().toISOString(), input.tileId);
    const tile = board.findTile(input.tileId);
    if (!tile) {
      return failed(`no tile ${input.tileId}`);
    }
    const key = input.prKey ?? (tile.members.length === 1 ? tile.members[0]!.prKey : null);
    const setId = setIdFromTileId(input.tileId);
    const topicId = this.realTopicId(key ? board.topicIdOf(key) : tile.topicId);

    return this.store.transaction(() => {
      for (const about of this.aboutKeys(input, key, tile, board)) {
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
        const at = this.now().toISOString();
        for (const layer of board.stackKeysOf(key)) {
          this.store.sets.removeMember(setId, layer, at);
        }
        this.store.sets.recordChange({ setId, topicId: tile.topicId, by: 'user', at, prKey: key, kind: 'left', reason: input.note.trim() || 'you said not related' });
        this.endSetIfTooSmall(setId, tile.topicId, at);
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
