import type { LivePollStatus, PrKey } from '@postpile/core';

/** The reads the watcher needs; the engine has both. */
export interface BoardReader {
  pingBadge(): Promise<number>;
  unreadPrKeys(): Promise<PrKey[]>;
}

export interface BoardSnapshot {
  /**
   * The Dock badge: tiles PostPile pinged about that are not handled yet
   * (DESIGN.md "Interruptions"). Never unread topics or merged PRs: the
   * number only holds what PostPile raised, and 0 under Never.
   */
  badge: number;
  unreadPrKeys: PrKey[];
}

/** What changes when the board can have changed: a poll cycle that stored something, a catch-up run, a sync. */
function statusSignature(status: LivePollStatus): string {
  return `${status.changeCount}:${status.catchUpChanges}:${status.syncRunning}`;
}

/**
 * Reads the board for the Mac surfaces (Dock badge, Notification Center)
 * and hands it to `onBoard`. The badge comes from the engine's held pings,
 * so no rule is repeated here.
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
      const badge = await this.reader.pingBadge();
      const unreadPrKeys = await this.reader.unreadPrKeys();
      this.onBoard({ badge, unreadPrKeys });
    } catch (error) {
      this.onError(error);
    }
  }
}
