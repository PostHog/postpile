import type { TopicAssignment, TopicChoice } from '@postpile/agent';
import { dossierBrief, newTopic, type Pr, type Topic } from '@postpile/core';
import { newTopicId } from '../ids.ts';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps } from './deps.ts';

/** PRs per assignment call. Keeps the prompt small enough for a quick answer. */
export const ASSIGNMENT_BATCH_SIZE = 20;

/** Retired topics stay on offer this long, so a late follow-up PR finds its old topic. */
const RETIRED_OFFER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * New topics one sync may create. The first real sync made 61 topics, most
 * with one or two PRs; past this cap PRs wait in Unsorted instead.
 */
export const MAX_NEW_TOPICS_PER_SYNC = 5;

/** Meta key: when a PR was left in Unsorted by topic assignment. */
export function deferredKey(prKey: string): string {
  return `topic_deferred:${prKey}`;
}

/**
 * Gives every PR without a topic to the agent, together with the existing
 * topics and their dossier briefs. The agent picks one or names a new topic.
 * New topics are created right away (otherwise a first sync would leave
 * everything unsorted); existing topics are never renamed or merged here.
 * Recently retired topics are offered too; a PR joining one brings it back.
 */
export class TopicAssigner {
  private created = 0;

  constructor(private readonly deps: DigestDeps) {}

  /**
   * A PR left in Unsorted is offered again only after the next
   * consolidation, which may have merged or reshaped topics; asking again
   * every sync would pay for the same "no fit" answer.
   */
  private isDeferred(prKey: string): boolean {
    const { store } = this.deps;
    const deferredAt = store.meta.get(deferredKey(prKey));
    if (deferredAt === null) {
      return false;
    }
    const consolidatedAt = store.cursors.get('consolidate', 'global')?.updatedAt ?? '';
    return deferredAt >= consolidatedAt;
  }

  private unassignedPrs(): Pr[] {
    const { store } = this.deps;
    const keys = store.memberships.listUnassignedPrKeys().filter((key) => !this.isDeferred(key));
    // Pinged or found; a pulled-in stack layer gets no topic of its own.
    const threads = store.notifications.getByPrKeys(keys);
    const found = store.foundPrs.listAll();
    return [...store.prs.getMany(keys.filter((key) => threads.has(key) || found.has(key))).values()];
  }

  /** Active topics plus topics retired in the last 30 days. */
  private offeredTopics(): Topic[] {
    const retiredSince = new Date(this.deps.now().getTime() - RETIRED_OFFER_MS).toISOString();
    return this.deps.store.topics
      .list()
      .filter((t) => t.status === 'active' || (t.status === 'retired' && t.updatedAt >= retiredSince));
  }

  private topicChoices(): TopicChoice[] {
    const topics = this.offeredTopics();
    const dossiers = this.deps.store.dossiers.latestMany(topics.map((t) => t.id));
    return topics.map((t) => {
      const dossier = dossiers.get(t.id);
      const brief = dossier ? dossierBrief(dossier.dossier) : '';
      return {
        id: t.id,
        name: t.name,
        summary: t.summary,
        brief: t.status === 'retired' ? `Finished, retired. ${brief}`.trim() : brief,
        memberCount: this.deps.store.memberships.listForTopic(t.id).length,
      };
    });
  }

  /** An existing topic of that name, a new one while under the cap, or null (the PR waits in Unsorted). */
  private findOrCreateTopic(name: string): Topic | null {
    const { store } = this.deps;
    const wanted = name.trim().toLowerCase();
    const existing = this.offeredTopics().find((t) => t.name.trim().toLowerCase() === wanted);
    if (existing) {
      return existing;
    }
    if (this.created >= MAX_NEW_TOPICS_PER_SYNC) {
      return null;
    }
    const topic = newTopic(newTopicId(name), name.trim(), this.deps.now().toISOString());
    store.topics.create(topic);
    this.created += 1;
    return topic;
  }

  private topicIdFor(assignment: TopicAssignment): string | null {
    if (assignment.kind === 'existing') {
      return assignment.topicId;
    }
    if (assignment.kind === 'new') {
      return this.findOrCreateTopic(assignment.name)?.id ?? null;
    }
    return null;
  }

  private apply(assignments: TopicAssignment[]): void {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    store.transaction(() => {
      for (const assignment of assignments) {
        const topicId = this.topicIdFor(assignment);
        if (topicId === null) {
          store.meta.set(deferredKey(assignment.prKey), at);
          continue;
        }
        if (store.topics.get(topicId)?.status === 'retired') {
          store.topics.setStatus(topicId, 'active', at);
        }
        store.memberships.assign({
          prKey: assignment.prKey,
          topicId,
          assignedBy: 'agent',
          reason: assignment.reason,
          createdAt: at,
        });
      }
    });
  }

  async run(): Promise<void> {
    for (const batch of chunk(this.unassignedPrs(), ASSIGNMENT_BATCH_SIZE)) {
      if (!this.deps.budget.take('topic_assignment')) {
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
        this.apply(assignments);
      } catch (error) {
        this.deps.errors.push(`topic assignment: ${errorText(error)}`);
      }
    }
  }
}
