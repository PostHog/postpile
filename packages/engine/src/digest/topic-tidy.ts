import type { TidyDestination, TidyTopic, TopicTidyResult } from '@postpile/agent';
import { cleanTopicName, newTopic, type PrKey, type TopicProposal } from '@postpile/core';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { errorText } from '../errors.ts';
import { newProposalId, newTopicId } from '../ids.ts';
import { changeTopicStatus } from '../topic-status.ts';
import type { DigestDeps } from './deps.ts';

/**
 * The topic grain this build cuts at. Raise it when a change to the topic
 * steering should also reshape existing users' topics: the next full sync
 * then runs the tidy once. 2: topics sized like projects (2026-10-01).
 */
export const TOPIC_GRAIN_VERSION = 2;

/** Meta key of the topic grain the stored topics were last tidied to. */
export const TOPIC_GRAIN_KEY = 'topic_grain_version';

/** What the last tidy did, for the CLI and for reading back later (JSON). */
export const TOPIC_TIDY_RESULT_KEY = 'topic_tidy_result';

/**
 * Once after an upgrade that changed how topics are cut (DESIGN.md "Topic
 * tidy after an upgrade"): one agent call reads every active topic and
 * answers with merges and splits, and the engine applies them right away.
 * The user decided this is part of the upgrade, not a pile of proposals.
 * Merges move the PRs and archive the merged-away topics, the way an
 * accepted merge does, and are recorded as accepted proposals from the
 * upgrade. Split PRs move to the topic the answer names, or a new one.
 * Runs before topic assignment, in the full sync only.
 */
export class TopicTidy {
  constructor(private readonly deps: DigestDeps) {}

  private due(): boolean {
    const stored = Number(this.deps.store.meta.get(TOPIC_GRAIN_KEY) ?? '0');
    return stored < TOPIC_GRAIN_VERSION;
  }

  private markDone(result: TopicTidyResult | null): void {
    const { store } = this.deps;
    store.meta.set(TOPIC_GRAIN_KEY, String(TOPIC_GRAIN_VERSION));
    if (result) {
      store.meta.set(TOPIC_TIDY_RESULT_KEY, JSON.stringify({ at: this.deps.now().toISOString(), ...result }));
    }
  }

  /** Due, with topics to tidy: runOnce calls the agent (budget allowing) instead of returning at once. */
  callsAgent(): boolean {
    return this.due() && this.deps.store.topics.listActive().some((topic) => topic.id !== UNSORTED_TOPIC_ID);
  }

  private topics(): TidyTopic[] {
    const { store } = this.deps;
    const active = store.topics.listActive().filter((topic) => topic.id !== UNSORTED_TOPIC_ID);
    const dossiers = store.dossiers.latestMany(active.map((topic) => topic.id));
    return active.map((topic) => {
      const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
      return {
        id: topic.id,
        name: topic.name,
        goal: dossiers.get(topic.id)?.dossier.goal || topic.summary,
        prs: [...store.prs.getMany(keys).values()],
      };
    });
  }

  /** The merge, written down as a proposal the upgrade made and accepted itself. */
  private record(from: string, into: string, reason: string, at: string): void {
    const proposal: TopicProposal = {
      id: newProposalId(),
      kind: 'merge',
      topicId: from,
      name: null,
      intoTopicId: into,
      fromArea: null,
      prKeys: [],
      reason,
      status: 'accepted',
      createdAt: at,
      decidedAt: at,
      source: 'upgrade',
      client: null,
    };
    this.deps.store.proposals.add(proposal);
  }

  /**
   * Folds topics into the one that names their project. A topic holding a PR
   * the user placed ("Wrong topic") is never folded away: the tidy never
   * sees who placed what, and folding would move and archive their call.
   */
  private applyMerges(result: TopicTidyResult, at: string): void {
    const { store } = this.deps;
    const holdsUserPlacement = (topicId: string): boolean => store.memberships.listForTopic(topicId).some((m) => m.assignedBy === 'user');
    for (const merge of result.merges) {
      const folding = merge.fromTopicIds.filter((from) => !holdsUserPlacement(from));
      if (folding.length === 0) {
        continue;
      }
      if (merge.name) {
        store.topics.rename(merge.intoTopicId, cleanTopicName(merge.name), at);
      }
      for (const from of folding) {
        // A new created_at marks them as joined, so the target's next dossier update introduces them.
        for (const membership of store.memberships.listForTopic(from)) {
          store.memberships.assign({ ...membership, topicId: merge.intoTopicId, assignedBy: 'agent', reason: merge.reason, createdAt: at });
        }
        changeTopicStatus(store, from, 'archive', at);
        this.record(from, merge.intoTopicId, merge.reason, at);
      }
    }
  }

  /**
   * Where split PRs go: the named topic while it is still active (a merge
   * may have folded it away), else an active topic of that name, else a new
   * one. Null when the destination is gone.
   */
  private destination(into: TidyDestination, at: string): string | null {
    const { store } = this.deps;
    if (into.kind === 'existing') {
      return store.topics.get(into.topicId)?.status === 'active' ? into.topicId : null;
    }
    const name = cleanTopicName(into.name);
    if (!name) {
      return null;
    }
    const same = store.topics.listActive().find((topic) => cleanTopicName(topic.name).toLowerCase() === name.toLowerCase());
    if (same) {
      return same.id;
    }
    const topic = newTopic(newTopicId(name), name, at);
    store.topics.create(topic);
    return topic.id;
  }

  /**
   * Moves split PRs where the answer says, in one step: handing them to the
   * topic assignment instead could put them straight back. A stack moves
   * whole, like everywhere else. A PR the user placed ("Wrong topic") stays
   * where they put it, and so does its whole stack: the tidy never sees who
   * placed what. A topic whose splits, stacks expanded, would take every PR
   * out keeps them all.
   */
  private applySplits(result: TopicTidyResult, at: string): void {
    const { store } = this.deps;
    const board = Board.load(store, at);
    const placedByUser = (key: PrKey): boolean => store.memberships.get(key)?.assignedBy === 'user';
    const leavingByTopic = new Map<string, Set<PrKey>>();
    for (const split of result.splits) {
      const units = split.prKeys.map((key) => board.movesWith(key)).filter((unit) => !unit.some(placedByUser));
      const leaving = leavingByTopic.get(split.topicId) ?? new Set<PrKey>();
      const members = store.memberships.listForTopic(split.topicId).map((m) => m.prKey);
      if (members.every((key) => leaving.has(key) || units.flat().includes(key))) {
        continue;
      }
      const target = this.destination(split.into, at);
      if (target === null || target === split.topicId) {
        continue;
      }
      for (const key of units.flat()) {
        leaving.add(key);
        store.memberships.assign({ prKey: key, topicId: target, assignedBy: 'agent', reason: split.reason, createdAt: at });
      }
      leavingByTopic.set(split.topicId, leaving);
    }
  }

  async runOnce(): Promise<void> {
    if (!this.due()) {
      return;
    }
    const topics = this.topics();
    // Nothing to tidy on a fresh install. One topic may still be a catch-all to split.
    if (topics.length === 0) {
      this.markDone(null);
      return;
    }
    if (!this.deps.budget.take('topic_tidy')) {
      return;
    }
    try {
      const result = await this.deps.agent.tidyTopics({ topics, viewer: this.deps.viewer, context: this.deps.contexts.forTopic(null) });
      const at = this.deps.now().toISOString();
      this.deps.store.transaction(() => {
        this.applyMerges(result, at);
        this.applySplits(result, at);
        this.markDone(result);
      });
    } catch (error) {
      // Not marked done: the next full sync tries again.
      this.deps.errors.push(`topic tidy: ${errorText(error)}`);
    }
  }
}
