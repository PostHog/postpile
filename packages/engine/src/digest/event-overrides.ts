import type { PrEvent, PrKey } from '@code-manager/core';
import { prKeyOfEvent } from '../ids.ts';
import { errorText } from '../errors.ts';
import type { DigestDeps } from './deps.ts';

/**
 * Second opinion on new loud events only: a wrong "loud" costs the user an
 * unread tile, a wrong "quiet" is still visible as a dot. The agent may
 * demote (or mute) with a reason; the override is stored on the event.
 */
export class EventOverrider {
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

  private async classify(key: PrKey, events: PrEvent[]): Promise<void> {
    const { store } = this.deps;
    const pr = store.prs.get(key);
    if (!pr || !this.deps.budget.take()) {
      return;
    }
    try {
      const topicId = store.memberships.get(key)?.topicId ?? null;
      const overrides = await this.deps.agent.classifyEvents({
        pr,
        viewer: this.deps.viewer,
        events,
        context: this.deps.contexts.forTopic(topicId),
      });
      store.transaction(() => {
        for (const override of overrides) {
          store.events.setOverride(override.eventId, { loudness: override.loudness, reason: override.reason, by: 'agent' });
        }
      });
    } catch (error) {
      this.deps.errors.push(`events ${key}: ${errorText(error)}`);
    }
  }

  async run(newEventIds: string[]): Promise<void> {
    const byPr = this.newLoudByPr(newEventIds);
    await Promise.all([...byPr].map(([key, events]) => this.classify(key, events)));
  }
}
