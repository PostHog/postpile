import type { IsoTime, Pr, PrKey, PrSet } from './types.ts';

// Two growth rules for agent-grouped sets (DESIGN.md "Tiles hold still",
// 2026-10-27). Both are about what a set may still take in, never about how
// its tile shows: a closed or full set keeps its id, members and place.

/** A finished set closes this many days after its last PR merged or closed. */
export const SET_CLOSE_AFTER_DAYS = 2;

/** A set with this many members takes no joins, and no merge goes past it. */
export const SET_MAX_MEMBERS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the PR merged or closed, or null while it is open. The close time is
 * the latest close in the timeline; a timeline cut off at its caps may miss
 * it, and then updatedAt stands in (later, so the set closes later, never early).
 */
function prFinishedAt(pr: Pr): IsoTime | null {
  if (pr.state === 'OPEN') {
    return null;
  }
  if (pr.state === 'MERGED' && pr.mergedAt !== null) {
    return pr.mergedAt;
  }
  const closes = pr.timeline.filter((item) => item.kind === 'closed' || item.kind === 'merged').map((item) => item.at);
  return closes.toSorted().at(-1) ?? pr.updatedAt;
}

/**
 * When the set finished: the latest merge or close among its members, once
 * every member is merged or closed. Null while one is open or not loaded.
 * Members the user removed ("not related") are not in `members`, so they
 * never hold a set open.
 */
export function setFinishedAt(set: PrSet, prs: Map<PrKey, Pr>): IsoTime | null {
  let latest: IsoTime | null = null;
  for (const member of set.members) {
    const pr = prs.get(member.prKey);
    const finished = pr ? prFinishedAt(pr) : null;
    if (finished === null) {
      return null;
    }
    if (latest === null || finished > latest) {
      latest = finished;
    }
  }
  return latest;
}

/**
 * The reason to close the set now, or null to leave it. A set closes
 * SET_CLOSE_AFTER_DAYS after it finished, so a quick follow-up can still
 * join it, but an old finished tile never takes new work again.
 */
export function setCloseReason(set: PrSet, prs: Map<PrKey, Pr>, now: IsoTime): string | null {
  if (set.status !== 'active' || set.closedAt) {
    return null;
  }
  const finishedAt = setFinishedAt(set, prs);
  if (finishedAt === null) {
    return null;
  }
  const days = Math.floor((new Date(now).getTime() - new Date(finishedAt).getTime()) / DAY_MS);
  if (days < SET_CLOSE_AFTER_DAYS) {
    return null;
  }
  return `every PR merged or closed ${days} days ago`;
}

/** True when the set takes no more joins. A set already past the cap stays as it is. */
export function setIsFull(set: PrSet): boolean {
  return set.members.length >= SET_MAX_MEMBERS;
}
