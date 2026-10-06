import type { FullPr, Topic } from '@postpile/core';
import { at, makeThreadFor } from '@postpile/core/fixtures';
import type { Harness } from './fakes.ts';

export function makeTopic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    name: id,
    summary: '',
    summaryInputHash: null,
    area: null,
    tailoring: '',
    driver: null,
    userRole: 'reviewer',
    status: 'active',
    kind: 'project',
    retiredAt: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

/** A stored topic with these PRs as user-assigned members; each PR also gets a notification thread. */
export function topicWithPrs(h: Harness, id: string, prs: FullPr[]): Topic {
  const topic = makeTopic(id);
  h.store.topics.create(topic);
  for (const pr of prs) {
    h.reader.addPr(pr, makeThreadFor(pr));
    h.store.memberships.assign({ prKey: pr.key, topicId: id, assignedBy: 'user', reason: '', createdAt: at(0) });
  }
  return topic;
}

/**
 * GitHub has the PRs' threads read (a visit on github.com, a mark-read that
 * went out): the reader answers them read from now on, and the store has
 * them read. Since "GitHub unread is PostPile unread" a tile only turns read
 * or done with its thread.
 */
export function readThreadsOnGitHub(h: Harness, prs: FullPr[]): void {
  for (const pr of prs) {
    const thread = h.reader.threads.find((candidate) => candidate.repo === pr.ref.repo && candidate.number === pr.ref.number);
    if (!thread) {
      continue;
    }
    const read = { ...thread, unread: false, lastReadAt: thread.updatedAt };
    h.reader.threads = h.reader.threads.map((candidate) => (candidate.id === thread.id ? read : candidate));
    h.store.notifications.markRead(thread.id, thread.updatedAt);
  }
}
