import type { TopicAssignment, TopicChoice } from '@postpile/agent';
import { buildStacks, cleanTopicName, dossierBrief, lastJoinAt, newTopic, stackByPrKey, stackTopicId, takesNewPrs, type Pr, type PrKey, type Topic, type TopicKind } from '@postpile/core';
import { Board } from '../board.ts';
import { newTopicId } from '../ids.ts';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import { changeTopicStatus } from '../topic-status.ts';
import type { DigestDeps } from './deps.ts';
import { TopicExclusions } from './topic-exclusions.ts';

/**
 * PRs per assignment call. Short PR details keep 40 in one prompt of a sane
 * size, and a big backlog lands in few calls where related PRs meet.
 */
export const ASSIGNMENT_BATCH_SIZE = 40;


/** The newest updatedAt among the PRs, or null for none. ISO strings sort by time. */
function newestUpdate(prs: Array<Pick<Pr, 'updatedAt'>>): string | null {
  let newest: string | null = null;
  for (const pr of prs) {
    if (newest === null || pr.updatedAt > newest) {
      newest = pr.updatedAt;
    }
  }
  return newest;
}

/** How the PRs waiting for a topic split up, treating each stack as one unit. */
interface StackSplit {
  /** Layers whose stack already shows in a topic: they join it without an agent call. */
  join: { prKey: PrKey; topicId: string }[];
  /** PRs to ask the agent about: lone PRs and the lowest waiting layer of each stack. */
  ask: PrKey[];
  /** The other waiting layers of a stack, by the layer asked about; they follow its answer. */
  followers: Map<PrKey, PrKey[]>;
}

/**
 * One person's work together, oldest first, so a project's PRs share a
 * request. Ordered by repo and branch name before (until 2026-10-01), which
 * scattered one person's feat/, fix/ and chore/ branches across batches.
 */
function askOrder(a: Pr, b: Pr): number {
  return a.author.localeCompare(b.author) || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
}

/**
 * Gives every PR without a topic to the agent, together with the existing
 * topics and their dossier briefs. The agent picks one or names a new topic,
 * for every PR: nothing is parked for a later tidy-up. New topics are
 * created right away, without a cap; the prompt keeps them few. Existing
 * topics are never renamed or merged here. Recently retired topics are
 * offered too; a PR joining one brings it back. A stack is one unit: its
 * layers always get the same topic. PRs an answer leaves out get one retry
 * batch; what is still missing (or cut by the call cap) stays without a
 * topic and is asked about again on the next sync. Neither the stack
 * shortcut nor an answer puts a PR back into a topic the user took it out
 * of ("Wrong topic", `TopicExclusions`).
 */
export class TopicAssigner {
  private followers = new Map<PrKey, PrKey[]>();
  private exclusions = new TopicExclusions();

  constructor(private readonly deps: DigestDeps) {}

  /**
   * Pinged or found PRs without a topic, on the hot board: a pulled-in
   * stack layer gets no topic of its own, and a cold PR none until it turns
   * hot (DESIGN.md "Big inboxes: what PostPile loads and works on").
   */
  private unassignedKeys(): PrKey[] {
    const { store } = this.deps;
    const keys = store.memberships.listUnassignedPrKeys();
    const threads = store.notifications.getByPrKeys(keys);
    const found = store.foundPrs.listAll();
    const hot = Board.load(store, this.deps.now().toISOString()).prs;
    return keys.filter((key) => (threads.has(key) || found.has(key)) && hot.has(key));
  }

  /**
   * A stack moves as one, so the agent never splits one across topics: a
   * layer whose stack already shows in a topic joins it, and of a stack
   * without a topic only the lowest waiting layer is asked about. A stack
   * topic that a waiting layer was taken out of ("Wrong topic") is no
   * shortcut: the waiting layers are asked about like a stack without one.
   */
  private splitByStack(keys: PrKey[]): StackSplit {
    const { store } = this.deps;
    const stackOf = stackByPrKey(buildStacks(store.prs.listHeaders()));
    const memberships = new Map(store.memberships.listAll().map((m) => [m.prKey, m]));
    const activeTopicIds = new Set(store.topics.listActive().map((topic) => topic.id));
    const waiting = new Set(keys);
    const split: StackSplit = { join: [], ask: [], followers: new Map() };
    const askedFor = new Map<string, PrKey>();
    for (const key of keys) {
      const stack = stackOf.get(key);
      if (!stack) {
        split.ask.push(key);
        continue;
      }
      const topicId = stackTopicId(stack, memberships, activeTopicIds);
      const waitingLayers = stack.prKeys.filter((layer) => waiting.has(layer));
      if (topicId !== null && !this.exclusions.forKeys(waitingLayers).has(topicId)) {
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
        // A new layer is new work: it brings its stack's retired topic back, as an agent answer does.
        changeTopicStatus(store, topicId, 'revive', at);
        store.memberships.assign({ prKey, topicId, assignedBy: 'agent', reason: 'joins its stack', createdAt: at });
      }
    });
  }

  /**
   * Active topics plus the Archive's topics that still take new PRs: a
   * project for 30 days, a standing topic until half a year without a new PR
   * (`takesNewPrs`), so its next wave finds it.
   */
  private offeredTopics(): Topic[] {
    const { store } = this.deps;
    const now = this.deps.now();
    return store.topics.list().filter((t) => takesNewPrs(t, lastJoinAt(store.memberships.listForTopic(t.id)), now));
  }

  /** Counts from the PR headers: reading every offered topic's snapshots cost a heavy install seconds and gigabytes. */
  private topicChoices(): TopicChoice[] {
    const topics = this.offeredTopics();
    const dossiers = this.deps.store.dossiers.latestMany(topics.map((t) => t.id));
    const headers = new Map(this.deps.store.prs.listHeaders().map((pr) => [pr.key, pr]));
    return topics.map((t) => {
      const dossier = dossiers.get(t.id);
      const brief = dossier ? dossierBrief(dossier.dossier) : '';
      const prs = this.deps.store.memberships.listForTopic(t.id).flatMap((m) => headers.get(m.prKey) ?? []);
      return {
        id: t.id,
        name: t.name,
        summary: t.summary,
        kind: t.kind,
        ownerTeam: dossier?.dossier.relation?.ownerTeam ?? null,
        brief: t.status === 'retired' ? `${t.kind === 'standing' ? 'Quiet for now, in the Archive.' : 'Finished, in the Archive.'} ${brief}`.trim() : brief,
        memberCount: prs.length,
        openCount: prs.filter((pr) => pr.state === 'OPEN').length,
        lastActivityAt: newestUpdate(prs),
      };
    });
  }

  /**
   * An offered topic of that name (any case), else a new one. A new topic's
   * summary is the goal sentence until its first dossier replaces it, so the
   * next batch sees what the topic is for, not only its name. The kind is the
   * agent's; a topic found by name keeps its own.
   */
  private findOrCreateTopic(name: string, goal: string, kind: TopicKind): Topic {
    const clean = cleanTopicName(name);
    const wanted = clean.toLowerCase();
    const existing = this.offeredTopics().find((t) => cleanTopicName(t.name).toLowerCase() === wanted);
    if (existing) {
      return existing;
    }
    const topic = { ...newTopic(newTopicId(clean), clean, this.deps.now().toISOString(), kind), summary: goal };
    this.deps.store.topics.create(topic);
    return topic;
  }

  private topicIdFor(assignment: TopicAssignment): string {
    if (assignment.kind === 'existing') {
      return assignment.topicId;
    }
    return this.findOrCreateTopic(assignment.name, assignment.goal, assignment.topicKind).id;
  }

  /** The PR the agent is asked about and the rest of its stack, which follows the answer. */
  private unitOf(prKey: PrKey): PrKey[] {
    return [prKey, ...(this.followers.get(prKey) ?? [])];
  }

  /**
   * Per PR of the batch, the offered topics the user took it (or a layer
   * that follows it) out of. PRs with none are left out.
   */
  private notIn(batch: Pr[], topics: TopicChoice[]): Record<PrKey, string[]> {
    const result: Record<PrKey, string[]> = {};
    for (const pr of batch) {
      const excluded = this.exclusions.forKeys(this.unitOf(pr.key));
      const ids = topics.map((topic) => topic.id).filter((id) => excluded.has(id));
      if (ids.length > 0) {
        result[pr.key] = ids;
      }
    }
    return result;
  }

  /**
   * Stores the answers and returns the PRs placed. An answer that puts a PR
   * into a topic the user took it out of, by id or by a "new" name that
   * finds that topic, is dropped: the PR counts as left out, so it gets the
   * retry and else waits in Unsorted for the next sync. A PR the user
   * placed while the call ran stays where they put it.
   */
  private apply(assignments: TopicAssignment[]): Set<PrKey> {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    const placed = new Set<PrKey>();
    store.transaction(() => {
      for (const assignment of assignments) {
        const keys = this.unitOf(assignment.prKey);
        const topicId = this.topicIdFor(assignment);
        if (this.exclusions.forKeys(keys).has(topicId)) {
          continue;
        }
        // A new PR is news: it brings a retired topic back.
        changeTopicStatus(store, topicId, 'revive', at);
        for (const prKey of keys.filter((key) => store.memberships.get(key)?.assignedBy !== 'user')) {
          store.memberships.assign({ prKey, topicId, assignedBy: 'agent', reason: assignment.reason, createdAt: at });
        }
        placed.add(assignment.prKey);
      }
    });
    return placed;
  }

  /**
   * One assignment call. Returns the PRs the answer left out or answered
   * badly (all of them when the call failed); none when the call cap is hit,
   * since those wait for the next sync anyway.
   */
  private async askBatch(batch: Pr[], waiting: Pr[]): Promise<Pr[]> {
    if (!this.deps.budget.take('topic_assignment')) {
      return [];
    }
    try {
      // Re-read per batch so a topic created by the previous batch is offered again.
      const topics = this.topicChoices();
      const assignments = await this.deps.agent.assignTopics({
        prs: batch,
        waiting,
        viewer: this.deps.viewer,
        topics,
        notIn: this.notIn(batch, topics),
        context: this.deps.contexts.forTopic(null),
      });
      // A new topic whose name is empty after cleaning is an unusable answer: the PR is asked again.
      const usable = assignments.filter((assignment) => assignment.kind !== 'new' || cleanTopicName(assignment.name) !== '');
      const placed = this.apply(usable);
      return batch.filter((pr) => !placed.has(pr.key));
    } catch (error) {
      this.deps.errors.push(`topic assignment: ${errorText(error)}`);
      return batch;
    }
  }

  /**
   * Batches one after the other, so each sees the topics the ones before
   * created, and every batch sees the round's whole backlog as one line per
   * PR. Returns the PRs still missing.
   */
  private async askRound(prs: Pr[]): Promise<Pr[]> {
    const missing: Pr[] = [];
    for (const batch of chunk(prs, ASSIGNMENT_BATCH_SIZE)) {
      missing.push(...(await this.askBatch(batch, prs)));
    }
    return missing;
  }

  /**
   * onlyKeys: ask only about these PRs (the live poll passes the PRs it just
   * fetched, so its one call is spent on them; the backlog stays with full
   * syncs). Null asks about every PR without a topic.
   */
  async run(onlyKeys: PrKey[] | null = null): Promise<void> {
    const only = onlyKeys === null ? null : new Set(onlyKeys);
    const keys = this.unassignedKeys().filter((key) => only === null || only.has(key));
    this.exclusions = TopicExclusions.load(this.deps.store);
    const split = this.splitByStack(keys);
    this.joinStacks(split.join);
    this.followers = split.followers;
    const asked = [...this.deps.store.prs.getMany(split.ask).values()].sort(askOrder);
    const missing = await this.askRound(asked);
    const stillMissing = await this.askRound(missing);
    if (stillMissing.length > 0) {
      const keys = stillMissing.map((pr) => pr.key).join(', ');
      this.deps.errors.push(`topic assignment: no topic after a retry, asked again next sync: ${keys}`);
    }
  }
}
