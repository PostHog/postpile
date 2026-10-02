import { clearableByRule, effectiveLoudness, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { prKeyOfEvent } from '../ids.ts';
import { changeTopicStatus } from '../topic-status.ts';

/**
 * Retiring is reversible: a retired topic comes back when one of its PRs gets
 * a new loud event, so a late mention on a merged PR is never hidden. Loud
 * as the agent left it (`effectiveLoudness`): the sync runs this after the
 * new events are classified, so an event the agent turned quiet brings
 * nothing back. Returns how many topics came back.
 */
export function reviveRetiredTopics(store: Store, newEventIds: string[], at: string): number {
  const wanted = new Set(newEventIds);
  const keys = [...new Set(newEventIds.map(prKeyOfEvent))];
  const topicIds = new Set<string>();
  for (const [key, events] of store.events.listForPrs(keys)) {
    const loud = events.some((e) => wanted.has(e.id) && effectiveLoudness(e) === 'loud' && e.seenAt === null);
    const topicId = store.memberships.get(key)?.topicId;
    if (loud && topicId) {
      topicIds.add(topicId);
    }
  }
  let revived = 0;
  store.transaction(() => {
    for (const topicId of topicIds) {
      if (changeTopicStatus(store, topicId, 'revive', at)) {
        revived += 1;
      }
    }
  });
  return revived;
}

/** The thread's PR, read as the quiet reads read it, would be cleared by rule. Unknown PR or no viewer: not clearable. */
function clearableNow(board: Board, prKey: PrKey, fetchedAt: Map<PrKey, string>): boolean {
  const thread = board.threads.get(prKey);
  const pr = board.prs.get(prKey);
  if (!thread || !pr || board.viewer === null) {
    return false;
  }
  return clearableByRule({
    thread,
    pr,
    events: board.events.get(prKey) ?? [],
    userState: board.userStates.get(prKey) ?? null,
    viewer: board.viewer,
    notYours: board.notYours.has(prKey),
    prFetchedAt: fetchedAt.get(prKey) ?? null,
  });
}

/**
 * A finished topic never holds an unread thread (DESIGN.md "GitHub unread is
 * PostPile unread"): every retired topic with a member PR whose thread is
 * unread on GitHub becomes active again, whether the thread just turned
 * unread or was unread when the topic retired (before 2026-09-30 the retire
 * gate did not look at threads). The full sync runs it after its quiet
 * reads and reads the unread state they left: a failed or capped quiet
 * write brings the topic back. The poll passes `skipClearableByRule` while
 * GitHub writes are on: a thread the quiet reads clear by rule
 * (`clearableByRule`) is left to the poll's own quiet reads at the end of
 * the cycle; one they leave unread (a failed or capped write) waits for the
 * next full sync, which clears it or brings the topic back. Returns how
 * many topics came back.
 */
export function reviveUnreadTopics(store: Store, at: string, skipClearableByRule: boolean): number {
  const retired = store.topics.list().filter((topic) => topic.status === 'retired');
  if (retired.length === 0) {
    return 0;
  }
  const board = Board.load(store, at);
  const fetchedAt = store.prs.fetchedAtByKey();
  const holdsUnread = (key: PrKey) => board.threads.get(key)?.unread === true && !(skipClearableByRule && clearableNow(board, key, fetchedAt));
  let revived = 0;
  store.transaction(() => {
    for (const topic of retired) {
      const keys = store.memberships.listForTopic(topic.id).map((membership) => membership.prKey);
      if (keys.some(holdsUnread) && changeTopicStatus(store, topic.id, 'revive', at)) {
        revived += 1;
      }
    }
  });
  return revived;
}
