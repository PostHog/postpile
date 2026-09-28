/** How long a PR opened on github.com from the app is refreshed on window focus. */
export const OPENED_PR_TTL_MS = 30 * 60 * 1000;

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/;

/** "owner/repo#123" for a github.com PR URL (any tab, anchor or query), else null. */
export function prKeyFromUrl(url: string): string | null {
  const match = PR_URL.exec(url);
  if (!match) {
    return null;
  }
  return `${match[1]}/${match[2]}#${match[3]}`;
}

/**
 * PRs the user opened on github.com from the app ("Open on GitHub", a PR
 * link). When the window gets focus back, these are the tiles most likely
 * to have changed (approved, merged, commented on there), so they get a
 * direct refresh. Each is kept OPENED_PR_TTL_MS after its last open.
 */
export class OpenedPrs {
  private readonly openedAt = new Map<string, number>();

  remember(url: string, nowMs: number): void {
    const key = prKeyFromUrl(url);
    if (key !== null) {
      this.openedAt.set(key, nowMs);
    }
  }

  /** Keys opened within the TTL; older ones are dropped. */
  active(nowMs: number): string[] {
    for (const [key, at] of this.openedAt) {
      if (nowMs - at > OPENED_PR_TTL_MS) {
        this.openedAt.delete(key);
      }
    }
    return [...this.openedAt.keys()];
  }
}
