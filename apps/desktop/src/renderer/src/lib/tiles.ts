import type { PrSet, PrSummary, TileView, UnreadReason } from '@postpile/core';
import { newest } from './time.ts';

/** "PostHog/posthog#41902" -> "41902". */
export function prNumber(key: string): string {
  return key.split('#')[1] ?? key;
}

/** "PR", "Stack · 3", "Set · 3". */
export function kindLabel(view: TileView): string {
  if (view.tile.kind === 'stack') {
    return `Stack · ${view.prs.length}`;
  }
  if (view.tile.kind === 'set') {
    return `Set · ${view.prs.length}`;
  }
  return 'PR';
}

/** The newest reason the tile is unread; the strip shows this one. */
export function newestUnreadReason(view: TileView): UnreadReason | null {
  const reasons = view.state.unreadBecause;
  return reasons[reasons.length - 1] ?? null;
}

/**
 * The PR the tile is mostly about: the one behind the newest unread reason,
 * else the first open pinged or found PR, else the first PR.
 */
export function leadPr(view: TileView): PrSummary | null {
  const reason = newestUnreadReason(view);
  const fromReason = reason ? view.prs.find((pr) => pr.key === reason.prKey) : undefined;
  if (fromReason) {
    return fromReason;
  }
  const openPinged = view.prs.find((pr) => pr.provenance.kind !== 'pulled_in' && pr.state === 'OPEN');
  return openPinged ?? view.prs[0] ?? null;
}

/** Every PR the tile tracks (not pulled-in stack context) is the viewer's own: the tile gets a "Your PR" marker. */
export function isOwnTile(view: TileView): boolean {
  const tracked = view.prs.filter((pr) => pr.provenance.kind !== 'pulled_in');
  return tracked.length > 0 && tracked.every((pr) => pr.authorRelation === 'you');
}

/**
 * The unread news is on the viewer's own PR and asks nothing of them (a bot,
 * a finished review): the strip says what happened and adds that no move is
 * needed, instead of reading like a to-do.
 */
export function isFyiNews(view: TileView): boolean {
  const reason = newestUnreadReason(view);
  const pr = reason ? view.prs.find((candidate) => candidate.key === reason.prKey) : undefined;
  return pr?.authorRelation === 'you' && view.turn.kind !== 'you';
}

/** The set's combined take for set tiles, else the lead PR's for_you line. */
export function tileForYou(view: TileView, sets: PrSet[]): string | null {
  if (view.tile.kind === 'set') {
    const set = sets.find((candidate) => `set:${candidate.id}` === view.tile.id);
    if (set?.take) {
      return set.take;
    }
  }
  return leadPr(view)?.forYou ?? null;
}

/** When anything in the tile last moved on GitHub. */
export function tileUpdatedAt(view: TileView): string | null {
  return newest(view.prs.map((pr) => pr.updatedAt));
}

export interface PrCounts {
  pinged: number;
  /** Not in the inbox, found by the sync (own open PRs, review requests, recent merges). */
  found: number;
  pulledIn: number;
}

/** Distinct PRs across tiles; a PR pinged in any tile counts as pinged, then found, else pulled in. */
export function countPrs(views: TileView[]): PrCounts {
  const pinged = new Set<string>();
  const found = new Set<string>();
  const all = new Set<string>();
  for (const view of views) {
    for (const pr of view.prs) {
      all.add(pr.key);
      if (pr.provenance.kind === 'pinged') {
        pinged.add(pr.key);
      } else if (pr.provenance.kind === 'found') {
        found.add(pr.key);
      }
    }
  }
  const foundOnly = [...found].filter((key) => !pinged.has(key)).length;
  return { pinged: pinged.size, found: foundOnly, pulledIn: all.size - pinged.size - foundOnly };
}
