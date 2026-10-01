import type { PrKey } from '@postpile/core';

/** A delivered ping stays closable for a day; older ones have left Notification Center's banner long ago. */
export const SHELF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The part of an Electron Notification the shelf needs. */
export interface Closable {
  close(): void;
}

interface Shelved {
  /** Every PR the ping is about; a summary has several. */
  prKeys: PrKey[];
  at: number;
  notification: Closable;
}

/**
 * The delivered pings, by PR key (it survives tiles being rebuilt), so one
 * can be taken back from Notification Center: once none of its PRs is
 * unread anymore, or once the user opens the tile of one of them in the app.
 * Bounded by age; a ping clicked or closed in Notification Center is
 * dropped. No Electron import, so it is tested with plain objects.
 */
export class PingShelf {
  private shelved: Shelved[] = [];

  /** A ping about no PR (the welcome, the test) is never shelved. */
  add(prKeys: PrKey[], notification: Closable, nowMs: number): void {
    if (prKeys.length > 0) {
      this.shelved.push({ prKeys, at: nowMs, notification });
    }
  }

  /** Closes the pings `shouldClose` picks, drops the ones older than a day; answers the closed ones. */
  private closeWhere(nowMs: number, shouldClose: (item: Shelved) => boolean): Closable[] {
    const keep: Shelved[] = [];
    const closed: Closable[] = [];
    for (const item of this.shelved) {
      if (nowMs - item.at >= SHELF_MAX_AGE_MS) {
        continue;
      }
      if (shouldClose(item)) {
        item.notification.close();
        closed.push(item.notification);
        continue;
      }
      keep.push(item);
    }
    this.shelved = keep;
    return closed;
  }

  /** Closes every ping none of whose PRs is unread anymore. */
  closeRead(unreadPrKeys: PrKey[], nowMs: number): Closable[] {
    const unread = new Set(unreadPrKeys);
    return this.closeWhere(nowMs, (item) => !item.prKeys.some((key) => unread.has(key)));
  }

  /** The user opened a tile holding these PRs: closes every ping about any of them, and only those (2026-10-01). */
  closeVisited(visitedPrKeys: PrKey[], nowMs: number): Closable[] {
    const visited = new Set(visitedPrKeys);
    return this.closeWhere(nowMs, (item) => item.prKeys.some((key) => visited.has(key)));
  }

  /** Clicked or closed in Notification Center: nothing left to take back. */
  remove(notification: Closable): void {
    this.shelved = this.shelved.filter((item) => item.notification !== notification);
  }

  size(): number {
    return this.shelved.length;
  }
}
