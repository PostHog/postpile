import type { ForWhom, PrSet, PrSummary, TileView, UnreadReason, WhatsNew } from '@postpile/core';
import { newest } from './time.ts';

/** "acme/app#1902" -> "1902". */
export function prNumber(key: string): string {
  return key.split('#')[1] ?? key;
}

/**
 * Same "for whom" (and same team). A stack or set row only shows its own
 * chip when it differs from the tile's, so the usual case stays quiet.
 */
export function sameForWhom(a: ForWhom, b: ForWhom): boolean {
  if (a.kind === 'team' && b.kind === 'team') {
    return a.team === b.team;
  }
  return a.kind === b.kind;
}

/**
 * The PRs that keep an unread tile unread: an unseen loud event on the PR
 * (`PrSummary.unseenLoudEvents`) or a reason in `unreadBecause`. Their rows
 * get the coral "new" dot, so a six-PR set shows which PR is new. Only on
 * unread tiles: a snoozed or done tile shows nothing new.
 */
export function newsPrKeys(view: Pick<TileView, 'state' | 'prs'>): Set<string> {
  if (view.state.kind !== 'unread') {
    return new Set();
  }
  const keys = new Set(view.state.unreadBecause.map((reason) => reason.prKey));
  for (const pr of view.prs) {
    if (pr.unseenLoudEvents > 0) {
      keys.add(pr.key);
    }
  }
  return keys;
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
 * The revisit summary for the strip: `whatsNew` of the PR behind the newest
 * unread reason. Null on a first look, so the strip keeps the event's words.
 */
export function stripNews(view: TileView): WhatsNew | null {
  const reason = newestUnreadReason(view);
  if (!reason) {
    return null;
  }
  return view.prs.find((pr) => pr.key === reason.prKey)?.whatsNew ?? null;
}

/**
 * The strip's "+N": other unread events on the tile. On a revisit the lead
 * already covers part of its PR's news, so it is that PR's extra count plus
 * the unread events on the tile's other PRs.
 */
export function stripMoreCount(view: TileView, news: WhatsNew | null): number {
  const reasons = view.state.unreadBecause;
  const reason = newestUnreadReason(view);
  if (!reason) {
    return 0;
  }
  if (!news) {
    return reasons.length - 1;
  }
  return news.extraCount + reasons.filter((other) => other.prKey !== reason.prKey).length;
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

/** Every open PR the tile tracks (not pulled-in context) is a draft: grey Draft chip, dashed frame, muted title. */
export function isDraftTile(view: TileView): boolean {
  const open = view.prs.filter((pr) => pr.provenance.kind !== 'pulled_in' && pr.state === 'OPEN');
  return open.length > 0 && open.every((pr) => pr.isDraft);
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
