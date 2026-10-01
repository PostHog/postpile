import type { TidyTopic, TopicTidyResult } from '@postpile/agent';
import { cleanTopicName, type PrKey, type TopicProposal } from '@postpile/core';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { errorText } from '../errors.ts';
import { newProposalId } from '../ids.ts';
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
 * upgrade. Split PRs lose their topic; the topic assignment that runs
 * right after places them under the current steering. Runs before topic
 * assignment, in the full sync only.
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

  private applyMerges(result: TopicTidyResult, at: string): void {
    const { store } = this.deps;
    for (const merge of result.merges) {
      if (merge.name) {
        store.topics.rename(merge.intoTopicId, cleanTopicName(merge.name), at);
      }
      for (const from of merge.fromTopicIds) {
        // A new created_at marks them as joined, so the target's next dossier update introduces them.
        for (const membership of store.memberships.listForTopic(from)) {
          store.memberships.assign({ ...membership, topicId: merge.intoTopicId, assignedBy: 'agent', reason: merge.reason, createdAt: at });
        }
        changeTopicStatus(store, from, 'archive', at);
        this.record(from, merge.intoTopicId, merge.reason, at);
      }
    }
  }

  /** A stack leaves whole, like everywhere else. */
  private applySplits(result: TopicTidyResult, at: string): void {
    const { store } = this.deps;
    const board = Board.load(store, at);
    const leaving = new Set<PrKey>(result.splits.flatMap((split) => split.prKeys.flatMap((key) => board.movesWith(key))));
    for (const key of leaving) {
      store.memberships.remove(key);
    }
  }

  async runOnce(): Promise<void> {
    if (!this.due()) {
      return;
    }
    const topics = this.topics();
    // Nothing to tidy on a fresh install: the topics are cut the new way from the start.
    if (topics.length < 2) {
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
