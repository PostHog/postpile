import type { TopicAssignment, TopicChoice } from '@postpile/agent';
import { buildStacks, dossierBrief, newTopic, stackByPrKey, stackTopicId, type PrKey, type Topic } from '@postpile/core';
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

/** How the PRs waiting for a topic split up, treating each stack as one unit. */
interface StackSplit {
  /** Layers whose stack already shows in a topic: they join it without an agent call. */
  join: { prKey: PrKey; topicId: string }[];
  /** PRs to ask the agent about: lone PRs and the lowest waiting layer of each stack. */
  ask: PrKey[];
  /** The other waiting layers of a stack, by the layer asked about; they follow its answer. */
  followers: Map<PrKey, PrKey[]>;
}

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
 * A stack is one unit: its layers always get the same topic.
 */
export class TopicAssigner {
  private created = 0;
  private followers = new Map<PrKey, PrKey[]>();

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

  /** Pinged or found PRs without a topic; a pulled-in stack layer gets no topic of its own. */
  private unassignedKeys(): PrKey[] {
    const { store } = this.deps;
    const keys = store.memberships.listUnassignedPrKeys();
    const threads = store.notifications.getByPrKeys(keys);
    const found = store.foundPrs.listAll();
    return keys.filter((key) => threads.has(key) || found.has(key));
  }

  /**
   * A stack moves as one, so the agent never splits one across topics: a
   * layer whose stack already shows in a topic joins it, and of a stack
   * without a topic only the lowest waiting layer is asked about.
   */
  private splitByStack(keys: PrKey[]): StackSplit {
    const { store } = this.deps;
    const stackOf = stackByPrKey(buildStacks(store.prs.listAll()));
    const memberships = new Map(store.memberships.listAll().map((m) => [m.prKey, m]));
    const split: StackSplit = { join: [], ask: [], followers: new Map() };
    const askedFor = new Map<string, PrKey>();
    for (const key of keys) {
      const stack = stackOf.get(key);
      if (!stack) {
        split.ask.push(key);
        continue;
      }
      const topicId = stackTopicId(stack, memberships);
      if (topicId !== null) {
        split.join.push({ prKey: key, topicId });
        continue;
      }
      const asked = askedFor.get(stack.id);
      if (asked === undefined) {
        askedFor.set(stack.id, key);
        split.ask.push(key);
      } else {
        split.followers.set(asked, [...(split.followers.get(asked) ?? []), key]);
      }
    }
    return split;
  }

  private joinStacks(join: StackSplit['join']): void {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    store.transaction(() => {
      for (const { prKey, topicId } of join) {
        store.memberships.assign({ prKey, topicId, assignedBy: 'agent', reason: 'joins its stack', createdAt: at });
      }
    });
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
        // The rest of a stack follows the layer the agent was asked about.
        const keys = [assignment.prKey, ...(this.followers.get(assignment.prKey) ?? [])];
        const topicId = this.topicIdFor(assignment);
        if (topicId === null) {
          keys.forEach((key) => store.meta.set(deferredKey(key), at));
          continue;
        }
        if (store.topics.get(topicId)?.status === 'retired') {
          store.topics.setStatus(topicId, 'active', at);
        }
        for (const prKey of keys) {
          store.memberships.assign({ prKey, topicId, assignedBy: 'agent', reason: assignment.reason, createdAt: at });
        }
      }
    });
  }

  async run(): Promise<void> {
    const split = this.splitByStack(this.unassignedKeys());
    this.joinStacks(split.join);
    this.followers = split.followers;
    const asked = [...this.deps.store.prs.getMany(split.ask.filter((key) => !this.isDeferred(key))).values()];
    for (const batch of chunk(asked, ASSIGNMENT_BATCH_SIZE)) {
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
