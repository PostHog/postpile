import type { Board } from '../board.ts';

/**
 * A topic with nothing left in it moves to the Archive by itself this long
 * after the last human activity (2026-10-01, was 3 days of any activity).
 */
export const ARCHIVE_QUIET_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * When a topic is over and moves to the Archive (status retired): every
 * member PR merged or closed, every thread of the topic read on GitHub,
 * every tile done, and no human activity for 2 days. Bot events (deploys,
 * CI, bot comments) do not count: they keep coming after a merge and kept
 * finished topics in the sidebar for days. "Done" rather than "nothing
 * unread": a merge without the user's review they have not seen keeps its
 * tile open, and its topic listed (DESIGN "Merged without your review").
 * Every thread read: a topic in the Archive never holds an unread thread
 * (DESIGN "GitHub unread is PostPile unread"); one whose thread turns
 * unread comes back (`reviveUnreadTopics`). Every full sync retires the
 * topics that pass (`retireFinishedTopics`); consolidation checks it too
 * before it follows the agent's "finished"; "Archive now" skips the wait.
 */
export class RetireGate {
  constructor(private readonly board: Board) {}

  private memberKeys(topicId: string): string[] {
    return [...this.board.memberships.values()].filter((m) => m.topicId === topicId).map((m) => m.prKey);
  }

  private allPrsOver(memberKeys: string[]): boolean {
    return memberKeys.every((key) => {
      const state = this.board.prs.get(key)?.state;
      return state === 'MERGED' || state === 'CLOSED';
    });
  }

  private everyTileDone(topicId: string): boolean {
    return this.board.tilesForTopic(topicId).every((tile) => this.board.stateOf(tile).kind === 'done');
  }

  /** No member PR, and no PR of the topic's tiles, has a thread unread on GitHub. */
  private everyThreadRead(topicId: string, memberKeys: string[]): boolean {
    const tileKeys = this.board.tilesForTopic(topicId).flatMap((tile) => tile.members.map((member) => member.prKey));
    return [...memberKeys, ...tileKeys].every((key) => this.board.threads.get(key)?.unread !== true);
  }

  /** The newest event of the topic's PRs a person made; null when there is none. */
  private lastHumanActivity(memberKeys: string[]): string | null {
    let latest: string | null = null;
    for (const key of memberKeys) {
      for (const event of this.board.events.get(key) ?? []) {
        if (!event.isBot && (latest === null || event.at > latest)) {
          latest = event.at;
        }
      }
    }
    return latest;
  }

  /** Nothing left for anyone: every PR over, every thread read, every tile done. "Archive now" needs this. */
  nothingLeft(topicId: string): boolean {
    const memberKeys = this.memberKeys(topicId);
    return memberKeys.length > 0 && this.allPrsOver(memberKeys) && this.everyThreadRead(topicId, memberKeys) && this.everyTileDone(topicId);
  }

  /** When a topic with nothing left moves to the Archive by itself; null while something is left. */
  archivesAt(topicId: string): string | null {
    if (!this.nothingLeft(topicId)) {
      return null;
    }
    const last = this.lastHumanActivity(this.memberKeys(topicId));
    return last === null ? this.board.now : new Date(new Date(last).getTime() + ARCHIVE_QUIET_MS).toISOString();
  }

  passes(topicId: string): boolean {
    const at = this.archivesAt(topicId);
    return at !== null && at <= this.board.now;
  }
}
