import type { IsoTime, Topic, TopicMembership, TopicStatus } from './types.ts';

/**
 * What can change a topic's status:
 * - retire: every PR is over and the topic went quiet (see RetireGate); it
 *   moves to the Archive drawer.
 * - revive: a retired topic got news: a loud event, a new PR, or the user
 *   moved a PR into it.
 * - archive: an accepted merge folded it into another topic. Never undone.
 */
export type TopicStatusCause = 'retire' | 'revive' | 'archive';

/** A topic's status after a change, with the time it retired (null unless retired). */
export interface TopicStatusChange {
  status: TopicStatus;
  retiredAt: IsoTime | null;
}

/**
 * The one rule for topic status. Returns the new status, or null when the
 * cause does not apply to the topic as it is (retiring a topic that is not
 * active, reviving one that is not retired, archiving one already archived).
 * Retiring records its own time, so later edits of the topic do not move it.
 */
export function nextTopicStatus(topic: Pick<Topic, 'status'>, cause: TopicStatusCause, at: IsoTime): TopicStatusChange | null {
  switch (cause) {
    case 'retire':
      return topic.status === 'active' ? { status: 'retired', retiredAt: at } : null;
    case 'revive':
      return topic.status === 'retired' ? { status: 'active', retiredAt: null } : null;
    case 'archive':
      return topic.status === 'archived' ? null : { status: 'archived', retiredAt: null };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a project in the Archive still takes a late follow-up PR. */
export const PROJECT_ARCHIVE_MS = 30 * DAY_MS;

/** How long a standing topic waits for its next PR before it retires for good. */
export const STANDING_IDLE_MS = 182 * DAY_MS;

/** When the newest PR joined the topic; null when none did. */
export function lastJoinAt(memberships: Pick<TopicMembership, 'createdAt'>[]): IsoTime | null {
  return memberships.reduce<IsoTime | null>((latest, m) => (latest === null || m.createdAt > latest ? m.createdAt : latest), null);
}

/**
 * When a topic in the Archive stops taking new PRs and retires for good: a
 * project 30 days after it got there, a standing topic half a year after the
 * last PR joined it (or after it got there, without a join on record). Null
 * for a topic not in the Archive.
 */
export function archiveEndsAt(topic: Pick<Topic, 'status' | 'kind' | 'retiredAt'>, lastJoin: IsoTime | null): IsoTime | null {
  if (topic.status !== 'retired' || topic.retiredAt === null) {
    return null;
  }
  const from = topic.kind === 'standing' ? (lastJoin ?? topic.retiredAt) : topic.retiredAt;
  const span = topic.kind === 'standing' ? STANDING_IDLE_MS : PROJECT_ARCHIVE_MS;
  return new Date(new Date(from).getTime() + span).toISOString();
}

/**
 * Whether a topic still takes new PRs: every active topic, and a topic in
 * the Archive until `archiveEndsAt`. Past that it is retired for good: the
 * agent no longer offers it and the Archive drawer drops it. A merged-away
 * topic never takes any.
 */
export function takesNewPrs(topic: Pick<Topic, 'status' | 'kind' | 'retiredAt'>, lastJoin: IsoTime | null, now: Date): boolean {
  if (topic.status === 'active') {
    return true;
  }
  const ends = archiveEndsAt(topic, lastJoin);
  return ends !== null && now.getTime() < new Date(ends).getTime();
}
