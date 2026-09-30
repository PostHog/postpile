import type { PrKey } from '@postpile/core';

/** A delivered ping stays closable for a day; older ones have left Notification Center's banner long ago. */
export const SHELF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The part of an Electron Notification the shelf needs. */
export interface Closable {
  close(): void;
}

interface Shelved {
  prKey: PrKey;
  at: number;
  notification: Closable;
}

/**
 * The delivered pings, by PR, so one can be taken back from Notification
 * Center once its tile is read or done in PostPile. Bounded by age. No
 * Electron import, so it is tested with plain objects.
 */
export class PingShelf {
  private shelved: Shelved[] = [];

  add(prKey: PrKey, notification: Closable, nowMs: number): void {
    this.shelved.push({ prKey, at: nowMs, notification });
  }

  /** Closes every ping whose PR is not unread anymore, and drops the ones older than a day. */
  closeRead(unreadPrKeys: PrKey[], nowMs: number): void {
    const unread = new Set(unreadPrKeys);
    const keep: Shelved[] = [];
    for (const item of this.shelved) {
      if (nowMs - item.at >= SHELF_MAX_AGE_MS) {
        continue;
      }
      if (unread.has(item.prKey)) {
        keep.push(item);
        continue;
      }
      item.notification.close();
    }
    this.shelved = keep;
  }

  size(): number {
    return this.shelved.length;
  }
}
