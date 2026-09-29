import type { IsoTime, Topic, TopicStatus } from './types.ts';

/**
 * What can change a topic's status:
 * - retire: every PR is over and the topic went quiet (see RetireGate).
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

/** A retired topic that retired at `since` or later (the Finished drawer, the topics offered to the agent). */
export function isRetiredSince(topic: Pick<Topic, 'status' | 'retiredAt'>, since: IsoTime): boolean {
  return topic.status === 'retired' && topic.retiredAt !== null && topic.retiredAt >= since;
}
