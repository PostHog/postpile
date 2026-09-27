import type { TopicAssignment, TopicChoice } from '@code-manager/agent';
import type { Pr, PrKey, Topic } from '@code-manager/core';
import { newTopicId } from '../ids.ts';
import { errorText, type DigestDeps } from './deps.ts';

/** PRs per assignment call. Keeps the prompt small enough for a quick answer. */
export const ASSIGNMENT_BATCH_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Gives every PR without a topic to the agent, together with the existing
 * topics. The agent picks one or names a new topic. New topics are created
 * right away (otherwise a first sync would leave everything unsorted);
 * existing topics are never renamed or merged here.
 */
export class TopicAssigner {
  constructor(private readonly deps: DigestDeps) {}

  private unassignedPrs(): Pr[] {
    const { store } = this.deps;
    const keys = store.memberships.listUnassignedPrKeys();
    const threads = store.notifications.getByPrKeys(keys);
    return [...store.prs.getMany(keys.filter((key) => threads.has(key))).values()];
  }

  private topicChoices(): TopicChoice[] {
    return this.deps.store.topics.listActive().map((t) => ({ id: t.id, name: t.name, summary: t.summary }));
  }

  private findOrCreateTopic(name: string): Topic {
    const { store } = this.deps;
    const wanted = name.trim().toLowerCase();
    const existing = store.topics.listActive().find((t) => t.name.trim().toLowerCase() === wanted);
    if (existing) {
      return existing;
    }
    const at = this.deps.now().toISOString();
    const topic: Topic = {
      id: newTopicId(name),
      name: name.trim(),
      summary: '',
      summaryInputHash: null,
      tailoring: '',
      driver: null,
      userRole: 'watcher',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    };
    store.topics.create(topic);
    return topic;
  }

  private apply(assignments: TopicAssignment[]): PrKey[] {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    return store.transaction(() =>
      assignments.map((assignment) => {
        const topicId = assignment.kind === 'existing' ? assignment.topicId : this.findOrCreateTopic(assignment.name).id;
        store.memberships.assign({
          prKey: assignment.prKey,
          topicId,
          assignedBy: 'agent',
          reason: assignment.reason,
          createdAt: at,
        });
        return assignment.prKey;
      }),
    );
  }

  /** Returns the keys that got a topic. */
  async run(): Promise<PrKey[]> {
    const assigned: PrKey[] = [];
    for (const batch of chunk(this.unassignedPrs(), ASSIGNMENT_BATCH_SIZE)) {
      if (!this.deps.budget.take()) {
        break;
      }
      try {
        const assignments = await this.deps.agent.assignTopics({
          prs: batch,
          viewer: this.deps.viewer,
          // Re-read per batch so a topic created by the previous batch is offered again.
          topics: this.topicChoices(),
          context: this.deps.contexts.forTopic(null),
        });
        assigned.push(...this.apply(assignments));
      } catch (error) {
        this.deps.errors.push(`topic assignment: ${errorText(error)}`);
      }
    }
    return assigned;
  }
}
