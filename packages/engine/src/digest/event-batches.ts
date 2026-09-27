import type { EventBatchInput } from '@code-manager/agent';
import type { PrEvent, PrKey } from '@code-manager/core';
import { errorText } from '../errors.ts';
import { prKeyOfEvent } from '../ids.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps } from './deps.ts';

/** PRs per event classification call. */
export const EVENT_BATCH_PRS = 20;

type EventItem = EventBatchInput['items'][number];

/**
 * Second opinion on new loud events only: a wrong "loud" costs the user an
 * unread tile, a wrong "quiet" is still visible as a dot. One call per topic
 * (20 PRs at most). The agent may demote (or mute) with a reason; the
 * override is stored on the event.
 */
export class EventBatchClassifier {
  constructor(private readonly deps: DigestDeps) {}

  private newLoudByPr(newEventIds: string[]): Map<PrKey, PrEvent[]> {
    const wanted = new Set(newEventIds);
    const keys = [...new Set(newEventIds.map(prKeyOfEvent))];
    const result = new Map<PrKey, PrEvent[]>();
    for (const [key, events] of this.deps.store.events.listForPrs(keys)) {
      const loud = events.filter((e) => wanted.has(e.id) && e.ruleLoudness === 'loud' && e.seenAt === null && !e.override);
      if (loud.length > 0) {
        result.set(key, loud);
      }
    }
    return result;
  }

  private itemsByTopic(newEventIds: string[]): Map<string | null, EventItem[]> {
    const { store } = this.deps;
    const byPr = this.newLoudByPr(newEventIds);
    const prs = store.prs.getMany([...byPr.keys()]);
    const result = new Map<string | null, EventItem[]>();
    for (const [key, events] of byPr) {
      const pr = prs.get(key);
      if (!pr) {
        continue;
      }
      const topicId = store.memberships.get(key)?.topicId ?? null;
      const items = result.get(topicId) ?? [];
      items.push({ pr, events });
      result.set(topicId, items);
    }
    return result;
  }

  private async classify(topicId: string | null, items: EventItem[]): Promise<void> {
    const { store } = this.deps;
    if (!this.deps.budget.take('event_classification')) {
      return;
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
    } catch (error) {
      this.deps.errors.push(`events ${topicId ?? 'unsorted'}: ${errorText(error)}`);
    }
  }

  async run(newEventIds: string[]): Promise<void> {
    const calls = [...this.itemsByTopic(newEventIds)].flatMap(([topicId, items]) =>
      chunk(items, EVENT_BATCH_PRS).map((part) => this.classify(topicId, part)),
    );
    await Promise.all(calls);
  }
}
