import type { Pr, Topic } from '@code-manager/core';
import { at, makeThreadFor } from '@code-manager/core/fixtures';
import type { Harness } from './fakes.ts';

export function makeTopic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    name: id,
    summary: '',
    summaryInputHash: null,
    tailoring: '',
    driver: null,
    userRole: 'reviewer',
    status: 'active',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

/** A stored topic with these PRs as user-assigned members; each PR also gets a notification thread. */
export function topicWithPrs(h: Harness, id: string, prs: Pr[]): Topic {
  const topic = makeTopic(id);
  h.store.topics.create(topic);
  for (const pr of prs) {
    h.reader.addPr(pr, makeThreadFor(pr));
    h.store.memberships.assign({ prKey: pr.key, topicId: id, assignedBy: 'user', reason: '', createdAt: at(0) });
  }
  return topic;
}
