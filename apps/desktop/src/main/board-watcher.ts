import type { ListScope, LivePollStatus, PrKey, TopicListItem } from '@postpile/core';

/** The reads the watcher needs; the engine has both. */
export interface BoardReader {
  listTopics(scope?: ListScope): Promise<TopicListItem[]>;
  unreadPrKeys(): Promise<PrKey[]>;
}

export interface BoardSnapshot {
  /** Live tiles where it is the viewer's move, summed across topics like the sidebar chips. */
  yourMoves: number;
  unreadPrKeys: PrKey[];
}

/** What changes when the board can have changed: a poll cycle that stored something, a catch-up run, a sync. */
function statusSignature(status: LivePollStatus): string {
  return `${status.changeCount}:${status.catchUpChanges}:${status.syncRunning}`;
}

/**
 * Reads the board for the Mac surfaces (Dock badge, Notification Center)
 * and hands it to `onBoard`. The count comes from the engine's topic list,
 * the same `yourMoves` the sidebar shows, so no rule is repeated here.
 * One read at a time; a request during a read runs once more afterwards.
 */
export class BoardWatcher {
  private running = false;
  private again = false;
  private lastSignature: string | null = null;

  constructor(
    private readonly reader: BoardReader,
    private readonly onBoard: (snapshot: BoardSnapshot) => void,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /** Reads now (after a ping, a local action or the start). */
  async refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.readOnce();
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  /** Reads when the live status moved since the last look. */
  async checkStatus(status: LivePollStatus): Promise<void> {
    const signature = statusSignature(status);
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;
    await this.refresh();
  }

  private async readOnce(): Promise<void> {
    try {
      const topics = await this.reader.listTopics({ allRepos: true });
      const unreadPrKeys = await this.reader.unreadPrKeys();
      const yourMoves = topics.reduce((sum, topic) => sum + topic.yourMoves.length, 0);
      this.onBoard({ yourMoves, unreadPrKeys });
    } catch (error) {
      this.onError(error);
    }
  }
}
