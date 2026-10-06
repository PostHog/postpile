// Which unread dots were on screen a moment ago, so a dot that hides ripples
// out even when its row remounts on the way (UnreadDot, Codex on PR #143):
// a tile that changes group on read gets a new row, and that row's dot mounts
// already hidden.

/** How long after a dot left the screen shown a hidden dot with its key still ripples. */
export const RECENT_DOT_MS = 1000;

/**
 * When each dot (by key) was last on screen shown: noted when a shown dot
 * hides or unmounts, taken by the next hidden dot with that key. Entries older
 * than RECENT_DOT_MS are dropped on every take, so the record stays small.
 */
export class RecentDots {
  private shownAt = new Map<string, number>();

  /** A shown dot hid or unmounted at `now`. */
  noteShown(key: string, now: number): void {
    this.shownAt.set(key, now);
  }

  /** Whether `key` was shown within RECENT_DOT_MS of `now`; the note is used up either way. */
  takeRecent(key: string, now: number): boolean {
    const at = this.shownAt.get(key);
    this.shownAt.delete(key);
    for (const [other, time] of this.shownAt) {
      if (now - time > RECENT_DOT_MS) {
        this.shownAt.delete(other);
      }
    }
    return at !== undefined && now - at <= RECENT_DOT_MS;
  }

  get size(): number {
    return this.shownAt.size;
  }
}
