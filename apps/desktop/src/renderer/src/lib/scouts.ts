// Scouts (DESIGN.md "Scouts"): PRs a scout pulled in from outside the GitHub
// inbox. Display only: never unread, never whose move, never counted. These
// helpers word the scout tile, the PR pane line and the sidebar count.
import type { GitHubWritesStatus, ScoutedPrView, ScoutFollowState, ScoutListItem, TileView } from '@postpile/core';

/** A scout's pseudo-topic id starts with this, like core's SCOUT_TOPIC_PREFIX (the renderer imports no core runtime). */
const SCOUT_TOPIC_PREFIX = 'scout:';

export function isScoutTopicId(topicId: string | null): boolean {
  return topicId !== null && topicId.startsWith(SCOUT_TOPIC_PREFIX);
}

/** The sidebar count's hover text: "2 unseen tiles of 4". */
export function scoutCountTitle(item: ScoutListItem): string {
  return `${item.unseen} of ${item.tiles} ${item.tiles === 1 ? 'tile' : 'tiles'} not seen in PostPile yet`;
}

/** The scout row's hover text: what the scout is and that nothing here is in the inbox. */
export function scoutRowTitle(item: ScoutListItem): string {
  if (item.tiles === 0) {
    return `${item.name}: nothing pulled in right now`;
  }
  return `${item.name}: ${item.tiles} ${item.tiles === 1 ? 'PR' : 'PRs'} from outside your GitHub inbox`;
}

/**
 * The line a waiting Follow puts on the tile and in the pane. Queued says
 * nothing: the toast's Undo covers its 6s window.
 */
export function followStateText(follow: ScoutFollowState | null): string | null {
  if (follow === 'pending') {
    return 'Follow pending: unlock GitHub writes';
  }
  if (follow === 'failed') {
    return 'Follow failed, send it from the lock';
  }
  return null;
}

/** Follow's hover text: what it does on GitHub, and that it waits in the lock while writes are locked. */
export function followTitle(writes: GitHubWritesStatus | undefined): string {
  if (writes && !writes.enabled) {
    return 'GitHub writes are locked: the Follow becomes a pending write and reaches GitHub once you send it from the lock in the footer.';
  }
  return 'Subscribes you to this PR on GitHub after 6s, so its news reaches your inbox and PostPile tracks it like your other PRs.';
}

/** The PR a scout tile's footer acts on: the one open in the pane when the tile is selected, else its first scouted PR. */
export function scoutTilePrKey(view: Pick<TileView, 'scout'>, selectedPrKey: string | null): string | null {
  const keys = view.scout?.prKeys ?? [];
  if (selectedPrKey !== null && keys.includes(selectedPrKey)) {
    return selectedPrKey;
  }
  return keys[0] ?? null;
}

/**
 * The PR to mark seen when the user opens it: a scouted PR of a scout tile
 * that still reads unseen. Null for any other tile or PR, and for an app pick
 * (the caller passes null then, like the opened-read dwell).
 */
export function scoutSeenTarget(view: Pick<TileView, 'scout'> | null, prKey: string | null): string | null {
  if (view === null || prKey === null || !view.scout?.unseen) {
    return null;
  }
  return view.scout.prKeys.includes(prKey) ? prKey : null;
}

const EXPIRY_WORDS = {
  merged: 'it merged',
  closed: 'it closed',
  inactive: 'no activity for days',
} as const;

/**
 * Where a scouted PR stands, after "Scouted by <name>: <reason>" in the pane:
 * followed, in the inbox now, dismissed (with its reason), off the section,
 * a waiting Follow, or still only here.
 */
export function scoutedStateText(view: Pick<ScoutedPrView, 'followedAt' | 'tracked' | 'inInbox' | 'dismissedAt' | 'dismissReason' | 'expiredAt' | 'expiryReason' | 'follow'>): string {
  if (view.inInbox) {
    return 'It reached your GitHub inbox since.';
  }
  if (view.followedAt !== null) {
    return 'You follow it on GitHub.';
  }
  if (view.tracked) {
    return 'PostPile tracks it now.';
  }
  if (view.dismissedAt !== null) {
    return view.dismissReason ? `Dismissed: ${view.dismissReason}` : 'Dismissed.';
  }
  if (view.expiredAt !== null) {
    return view.expiryReason ? `Off the Scouted section: ${EXPIRY_WORDS[view.expiryReason]}.` : 'Off the Scouted section.';
  }
  const follow = followStateText(view.follow);
  return follow ? `${follow}.` : 'Not in your GitHub inbox.';
}
