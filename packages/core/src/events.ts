import type { Pr, PrEvent, UserPrState, Viewer } from './types.ts';

/**
 * Turns a PR snapshot into event lines: comments, reviews, commits and
 * timeline items, each classified by ruleLoudness. Returned events have
 * seenAt and override set to null; the store keeps those across syncs.
 */
export function deriveEvents(_pr: Pr, _viewer: Viewer, _userState: UserPrState | null): PrEvent[] {
  throw new Error('not implemented');
}
