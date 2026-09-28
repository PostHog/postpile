import type { EventBatchInput } from '@postpile/agent';
import type { PrEvent, PrKey } from '@postpile/core';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps } from './deps.ts';

/** PRs per event classification call. */
export const EVENT_BATCH_PRS = 20;

/** Classify cursor scope for PRs without a topic. */
const UNSORTED_SCOPE = 'unsorted';

type EventItem = EventBatchInput['items'][number];

/** One topic (or Unsorted) and its PRs, each with its own classify cursor. */
interface EventGroup {
  topicId: string | null;
  scope: string;
  prKeys: PrKey[];
}

function needsOpinion(event: PrEvent): boolean {
  return event.ruleLoudness === 'loud' && event.seenAt === null && event.override === null;
}

/**
 * Second opinion on loud events only: a wrong "loud" costs the user an
 * unread tile, a wrong "quiet" is still visible as a dot. One call per topic
 * (20 PRs at most). The agent may demote (or mute) with a reason; the
 * override is stored on the event.
 *
 * Driven by the event log, not by this sync's new events: every topic has a
 * classify cursor that only moves once all its batches ran. Batches the call
 * cap skips wait for the next sync instead of being lost.
 */
export class EventBatchClassifier {
  constructor(private readonly deps: DigestDeps) {}

  private groups(): EventGroup[] {
    const { store } = this.deps;
    const topics = store.topics.listActive().map((topic) => ({
      topicId: topic.id,
      scope: topic.id,
      prKeys: store.memberships.listForTopic(topic.id).map((m) => m.prKey),
    }));
    // Only pinged PRs: a pulled-in stack layer gets no agent calls of its own.
    const unassigned = store.memberships.listUnassignedPrKeys();
    const threads = store.notifications.getByPrKeys(unassigned);
    const unsorted = { topicId: null, scope: UNSORTED_SCOPE, prKeys: unassigned.filter((key) => threads.has(key)) };
    return [...topics, unsorted];
  }

  /** Loud, unseen events without an override, logged after afterSeq, per PR. */
  private items(prKeys: PrKey[], afterSeq: number): EventItem[] {
    const byPr = new Map<PrKey, PrEvent[]>();
    for (const { event } of this.deps.store.eventLog.listSince(prKeys, afterSeq)) {
      if (needsOpinion(event)) {
        const list = byPr.get(event.prKey) ?? [];
        list.push(event);
        byPr.set(event.prKey, list);
      }
    }
    const prs = this.deps.store.prs.getMany([...byPr.keys()]);
    return [...byPr].flatMap(([key, events]) => {
      const pr = prs.get(key);
      return pr ? [{ pr, events }] : [];
    });
  }

  /** False when the budget skipped the call or it failed, so the topic's cursor stays put. */
  private async classify(topicId: string | null, items: EventItem[]): Promise<boolean> {
    const { store } = this.deps;
    if (!this.deps.budget.take('event_classification')) {
      return false;
    }
    try {
      const overrides = await this.deps.agent.classifyEventBatch({
        topic: topicId === null ? null : store.topics.get(topicId),
        items,
        viewer: this.deps.viewer,
        context: this.deps.contexts.forTopic(topicId),
      });
      store.transaction(() => {
        for (const override of overrides) {
          store.events.setOverride(override.eventId, { loudness: override.loudness, reason: override.reason, by: 'agent' });
        }
      });
      return true;
    } catch (error) {
      this.deps.errors.push(`events ${topicId ?? 'unsorted'}: ${errorText(error)}`);
      return false;
    }
  }

  private async runGroup(group: EventGroup, toSeq: number): Promise<void> {
    const { store } = this.deps;
    const cursorSeq = store.cursors.get('classify', group.scope)?.seq ?? 0;
    const batches = chunk(this.items(group.prKeys, cursorSeq), EVENT_BATCH_PRS);
    const done = await Promise.all(batches.map((batch) => this.classify(group.topicId, batch)));
    if (done.every(Boolean)) {
      const updatedAt = this.deps.now().toISOString();
      store.cursors.advance({ kind: 'classify', scope: group.scope, seq: toSeq, dossierVersion: null, updatedAt });
    }
  }

  async run(): Promise<void> {
    // Taken once up front: events logged while calls run are left for the next sync.
    const toSeq = this.deps.store.eventLog.maxSeq();
    await Promise.all(this.groups().map((group) => this.runGroup(group, toSeq)));
  }
}
