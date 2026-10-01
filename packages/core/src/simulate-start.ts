// Round planning for the dev command `pnpm cli simulate-start`: a new user
// starts PostPile on an inbox they never cleared, picks "start with the last
// N days", and the backlog drains in capped full syncs. Rules only, no IO.
// The order follows the real sync (`selectSyncThreads`): unread first,
// newest first, at most SYNC_MAX_PRS pinged PRs per sync; found PRs and the
// stack layers of what came in ride along without counting.
import { selectSyncThreads, type SyncThread } from './sync-selection.ts';
import type { IsoTime, PrKey } from './types.ts';

/** A stack layer the source sync pulled in, hanging off the tracked PR `anchorPrKey`. */
export interface SimulationPullIn {
  prKey: PrKey;
  anchorPrKey: PrKey;
}

export interface SimulationInput {
  /** Every notification thread of a PR, read or unread, any age. */
  threads: SyncThread[];
  /** Found PRs (own open PRs, review requests, recent merges): all come in with the first round. */
  found: PrKey[];
  pullIns: SimulationPullIn[];
  /** PRs with a stored snapshot; nothing else can come in. */
  stored: Set<PrKey>;
  now: IsoTime;
  /** Only threads updated in the last `days` count. */
  days: number;
  /** Pinged PRs per round, like the sync's maxPrs. */
  roundSize: number;
}

/** PRs whose snapshot and events come in during one round, each PR in exactly one round. */
export interface SimulationRound {
  /** PRs with a thread in the window, in the order the sync drains them. */
  pinged: PrKey[];
  /** Found PRs not already pinged in this round (first round only). */
  found: PrKey[];
  /** Stack layers whose anchor came in by now. */
  pulledIn: PrKey[];
}

/** The newest of these times: "now" of a source database, so a simulation does not depend on when it runs. Null for none. */
export function simulationNow(times: IsoTime[]): IsoTime | null {
  let newest: IsoTime | null = null;
  for (const time of times) {
    if (newest === null || time > newest) {
      newest = time;
    }
  }
  return newest;
}

/** PR keys with a thread updated in the last `days`, in drain order: unread first, newest first, one per PR. */
export function windowPrKeys(threads: SyncThread[], now: IsoTime, days: number): PrKey[] {
  return selectSyncThreads(threads, new Map(), now, days).map((thread) => thread.key);
}

/** Every pull-in whose anchor is in `revealed` (directly or through another layer) and that is not revealed yet. */
function layersFor(pullIns: SimulationPullIn[], revealed: Set<PrKey>, stored: Set<PrKey>): PrKey[] {
  const layers: PrKey[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const pullIn of pullIns) {
      if (revealed.has(pullIn.anchorPrKey) && !revealed.has(pullIn.prKey) && stored.has(pullIn.prKey)) {
        revealed.add(pullIn.prKey);
        layers.push(pullIn.prKey);
        added = true;
      }
    }
  }
  return layers;
}

/**
 * Splits the window into rounds. Round one takes the first `roundSize`
 * pinged PRs plus every found PR; each later round the next `roundSize`
 * pinged PRs not in yet. A PR that already came in (found, or as a stack
 * layer) is not picked again, as the real sync skips a PR fetched since its
 * last activity. Stack layers come in with their anchor.
 */
export function planRounds(input: SimulationInput): SimulationRound[] {
  const candidates = windowPrKeys(input.threads, input.now, input.days).filter((key) => input.stored.has(key));
  const found = [...input.found].filter((key) => input.stored.has(key)).sort();
  const revealed = new Set<PrKey>();
  const rounds: SimulationRound[] = [];
  let next = 0;
  while (next < candidates.length || rounds.length === 0) {
    const pinged: PrKey[] = [];
    while (pinged.length < input.roundSize && next < candidates.length) {
      const key = candidates[next]!;
      next += 1;
      if (!revealed.has(key)) {
        pinged.push(key);
        revealed.add(key);
      }
    }
    const roundFound = rounds.length === 0 ? found.filter((key) => !revealed.has(key)) : [];
    for (const key of roundFound) {
      revealed.add(key);
    }
    const pulledIn = layersFor(input.pullIns, revealed, input.stored);
    if (pinged.length === 0 && roundFound.length === 0 && pulledIn.length === 0) {
      break;
    }
    rounds.push({ pinged, found: roundFound, pulledIn });
  }
  return rounds;
}

/** Every PR of a round, in reveal order. */
export function roundPrKeys(round: SimulationRound): PrKey[] {
  return [...round.pinged, ...round.found, ...round.pulledIn];
}
