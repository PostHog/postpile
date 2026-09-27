import { isPinged, type ActionResult, type FeedbackInput, type PrKey, type Tile } from '@code-manager/core';
import type { NewFeedback, Store } from '@code-manager/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { prKeyOfEvent } from '../ids.ts';
import { failed, ok } from './results.ts';

function setIdOf(tileId: string): string | null {
  return tileId.startsWith('set:') ? tileId.slice('set:'.length) : null;
}

/**
 * User corrections. Each one is logged (the newest go back into prompts) and
 * applied right away where there is something to apply.
 */
export class FeedbackActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  private realTopicId(topicId: string | null): string | null {
    return topicId === UNSORTED_TOPIC_ID ? null : topicId;
  }

  private log(entry: Omit<NewFeedback, 'createdAt'>): void {
    this.store.feedback.add({ ...entry, createdAt: this.now().toISOString() });
  }

  /** "Not mine": the pinged PRs count as handled, and the agent learns from the note. */
  private notMine(tile: Tile, key: PrKey | null): void {
    const at = this.now().toISOString();
    const keys = key ? [key] : tile.members.filter((m) => isPinged(m.provenance)).map((m) => m.prKey);
    for (const handled of keys) {
      this.store.userPrStates.markHandled(handled, at);
    }
  }

  /** "Wrong topic": move it when the user said where, otherwise let the next sync re-sort it. */
  private wrongTopic(key: PrKey, targetTopicId: string | null, note: string): ActionResult {
    if (targetTopicId !== null) {
      if (!this.store.topics.get(targetTopicId)) {
        return failed(`no topic ${targetTopicId}`);
      }
      this.store.memberships.assign({
        prKey: key,
        topicId: targetTopicId,
        assignedBy: 'user',
        reason: note || 'moved by the user',
        createdAt: this.now().toISOString(),
      });
      return ok('Moved');
    }
    this.store.memberships.remove(key);
    return ok('Will be re-sorted on the next sync');
  }

  giveFeedback(input: FeedbackInput): ActionResult {
    const board = Board.load(this.store, this.now().toISOString());
    const tile = board.findTile(input.tileId);
    if (!tile) {
      return failed(`no tile ${input.tileId}`);
    }
    const key = input.prKey ?? (tile.members.length === 1 ? tile.members[0]!.prKey : null);
    const setId = setIdOf(input.tileId);
    const topicId = this.realTopicId(key ? board.topicIdOf(key) : tile.topicId);

    return this.store.transaction(() => {
      this.log({ kind: input.kind, topicId, tileId: input.tileId, prKey: key, setId, eventId: null, note: input.note });
      if (input.kind === 'not_mine') {
        this.notMine(tile, key);
        return ok('Noted: not yours');
      }
      if (input.kind === 'not_related') {
        if (!setId || !key) {
          return failed('"Not related" needs a set tile and the PR to drop');
        }
        this.store.sets.removeMember(setId, key, this.now().toISOString());
        return ok('Removed from the set');
      }
      if (!key) {
        return failed('"Wrong topic" needs the PR');
      }
      return this.wrongTopic(key, input.targetTopicId, input.note);
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
