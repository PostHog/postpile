import type { DatabaseSync } from 'node:sqlite';
import type { Feedback } from '@code-manager/core';

export type NewFeedback = Omit<Feedback, 'id'>;

export class FeedbackRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(_feedback: NewFeedback): Feedback {
    throw new Error('not implemented');
  }

  /** Newest first. Fed back into prompts for that topic. */
  recentForTopic(_topicId: string, _limit: number): Feedback[] {
    throw new Error('not implemented');
  }

  /** Newest first, across topics. For prompts that have no topic yet (assignment). */
  recent(_limit: number): Feedback[] {
    throw new Error('not implemented');
  }
}
