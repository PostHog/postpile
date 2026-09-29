import {
  actionTrail,
  botsFromQuietDetail,
  quietReasonFromDetail,
  debugEventLines,
  parsePrKey,
  type ActionLogEntry,
  type ActionLogIndex,
  threadPrKey,
  type NotificationDebugRow,
  type NotificationLanding,
  type NotificationThread,
  type PingDecision,
  type PrKey,
  type QuietReadView,
} from '@postpile/core';
import { UNSORTED_TOPIC_ID, type Board } from './board.ts';

/** Where the thread's PR shows up: the tile in the PR's own topic (Unsorted included), else why not. */
export function landingOf(board: Board, key: PrKey | null): NotificationLanding {
  if (key === null) {
    return { kind: 'not_pr' };
  }
  if (!board.prs.has(key)) {
    return { kind: 'pr_not_synced' };
  }
  const topicId = board.topicIdOf(key);
  if (topicId === null) {
    return { kind: 'no_topic' };
  }
  const topic = board.topic(topicId);
  const topicName = topic?.name ?? topicId;
  if (!board.topics().some((candidate) => candidate.id === topicId)) {
    return { kind: 'topic_hidden', topicId, topicName };
  }
  const tile = board.tilesForTopic(topicId).find((candidate) => candidate.members.some((member) => member.prKey === key));
  if (!tile) {
    return { kind: 'no_tile', topicId, topicName };
  }
  return {
    kind: 'tile',
    topicId,
    topicName,
    tileId: tile.id,
    tileTitle: tile.title,
    tileState: board.stateOf(tile).kind,
    unsorted: topicId === UNSORTED_TOPIC_ID,
  };
}

/**
 * The stored notification threads as GitHub sent them (the caller passes them
 * newest first), each with where it landed, its PR's newest events and the
 * app's last logged action on it, plus the live poll's newest ping decisions
 * by thread id. Reads only; nothing here touches GitHub.
 */
export function debugNotificationRows(
  board: Board,
  threads: NotificationThread[],
  actions: ActionLogIndex,
  decisions: Map<string, PingDecision[]>,
): NotificationDebugRow[] {
  return threads.map((thread) => {
    const key = threadPrKey(thread);
    return {
      thread,
      prKey: key,
      landing: landingOf(board, key),
      recentEvents: key === null ? [] : debugEventLines(board.events.get(key) ?? []),
      ...actionTrail(actions, thread.id, key),
      pingDecisions: decisions.get(thread.id) ?? [],
    };
  });
}

/**
 * "Handled quietly" rows from the action log: the quiet mark-reads that
 * reached GitHub (entries in any order come back as given), each with the
 * PR's title and where it lands now.
 */
export function quietReadViews(board: Board, entries: ActionLogEntry[], threadTitles: Map<string, string>): QuietReadView[] {
  return entries.flatMap((entry): QuietReadView[] => {
    if (entry.action !== 'mark_read' || entry.outcome !== 'github' || entry.prKey === null) {
      return [];
    }
    const ref = parsePrKey(entry.prKey);
    const threadTitle = entry.threadId === null ? undefined : threadTitles.get(entry.threadId);
    return [
      {
        id: entry.id,
        at: entry.at,
        threadId: entry.threadId,
        prKey: entry.prKey,
        repo: ref.repo,
        number: ref.number,
        title: board.prs.get(entry.prKey)?.title ?? threadTitle ?? entry.prKey,
        reason: quietReasonFromDetail(entry.detail),
        bots: botsFromQuietDetail(entry.detail),
        landing: landingOf(board, entry.prKey),
      },
    ];
  });
}
