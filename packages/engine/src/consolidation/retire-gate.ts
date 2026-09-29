import type { Board } from '../board.ts';

/** A finished topic must have been quiet this long before it is retired. */
export const RETIRE_QUIET_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * When a topic is over: every member PR merged or closed, no events for 3
 * days, and no unread or snoozed tile left. Every full sync retires the
 * topics that pass (`retireFinishedTopics`); consolidation checks it too
 * before it follows the agent's "finished".
 */
export class RetireGate {
  constructor(private readonly board: Board) {}

  private allPrsOver(memberKeys: string[]): boolean {
    return memberKeys.every((key) => {
      const state = this.board.prs.get(key)?.state;
      return state === 'MERGED' || state === 'CLOSED';
    });
  }

  private quietSince(memberKeys: string[], cutoff: string): boolean {
    return memberKeys.every((key) => (this.board.events.get(key) ?? []).every((event) => event.at <= cutoff));
  }

  private nothingWaiting(topicId: string): boolean {
    return this.board.tilesForTopic(topicId).every((tile) => {
      const kind = this.board.stateOf(tile).kind;
      return kind !== 'unread' && kind !== 'snoozed';
    });
  }

  passes(topicId: string): boolean {
    const memberKeys = [...this.board.memberships.values()].filter((m) => m.topicId === topicId).map((m) => m.prKey);
    if (memberKeys.length === 0) {
      return false;
    }
    const cutoff = new Date(new Date(this.board.now).getTime() - RETIRE_QUIET_MS).toISOString();
    return this.allPrsOver(memberKeys) && this.quietSince(memberKeys, cutoff) && this.nothingWaiting(topicId);
  }
}
