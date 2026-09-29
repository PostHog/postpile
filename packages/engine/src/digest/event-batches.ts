import type { EventBatchInput } from '@postpile/agent';
import { isUnansweredAsk, PERSONAL_ASK_KINDS, type PrEvent, type PrKey } from '@postpile/core';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps, TopicScope } from './deps.ts';

/** PRs per event classification call. */
export const EVENT_BATCH_PRS = 20;

/** Classify cursor scope for PRs without a topic. */
const UNSORTED_SCOPE = 'unsorted';

/**
 * Set once the one-time re-judge of stuck asks ran for every topic (see
 * `stuckAsks`). Each topic (or Unsorted) also gets `<key>:<scope>` once its
 * own batches ran, so a topic the call cap skipped does not make the others
 * send their asks again.
 */
export const REJUDGE_ASKS_KEY = 'events_rejudge_asks_v1';

function rejudgeKey(group: EventGroup): string {
  return `${REJUDGE_ASKS_KEY}:${group.scope}`;
}

type EventItem = EventBatchInput['items'][number];

/** One topic (or Unsorted) and its PRs, each with its own classify cursor. */
interface EventGroup {
  topicId: string | null;
  scope: string;
  prKeys: PrKey[];
}

/**
 * Loud events get a second opinion (demote or mute). A push after the
 * viewer's approval starts quiet and goes to the agent too, which may raise
 * it when the push changes what was approved. A loud personal ask (mention,
 * question, reply) goes even once it is read: it stays the viewer's move
 * until answered, unless the agent says it asks nothing ("thanks!").
 */
function needsOpinion(event: PrEvent): boolean {
  if (event.override !== null) {
    return false;
  }
  if (event.ruleLoudness === 'loud' && PERSONAL_ASK_KINDS.includes(event.kind)) {
    return true;
  }
  if (event.seenAt !== null) {
    return false;
  }
  return event.ruleLoudness === 'loud' || event.kind === 'commits_after_approval';
}

/**
 * Second opinion on loud events, plus pushes after the viewer's approval: a
 * wrong "loud" costs the user an unread tile (and, on an ask, a "your move"
 * footer), a wrong "quiet" is still visible as a dot. One call per topic
 * (20 PRs at most). The agent may demote (or mute) with a reason; the
 * override is stored on the event.
 *
 * Driven by the event log, not by this sync's new events: every topic has a
 * classify cursor that only moves once all its batches ran. Batches the call
 * cap skips wait for the next sync instead of being lost.
 */
export class EventBatchClassifier {
  constructor(private readonly deps: DigestDeps) {}

  /**
   * Retired topics too: their new events are judged before the sync decides
   * whether one brings the topic back (`reviveRetiredTopics`). A retired
   * topic without news has nothing past its cursor and costs no call.
   */
  private groups(): EventGroup[] {
    const { store } = this.deps;
    const judged = store.topics.list().filter((topic) => topic.status !== 'archived');
    const topics = judged.map((topic) => ({
      topicId: topic.id,
      scope: topic.id,
      prKeys: store.memberships.listForTopic(topic.id).map((m) => m.prKey),
    }));
    // Only pinged and found PRs: a pulled-in stack layer gets no agent calls of its own.
    const unassigned = store.memberships.listUnassignedPrKeys();
    const threads = store.notifications.getByPrKeys(unassigned);
    const found = store.foundPrs.listAll();
    const unsorted = { topicId: null, scope: UNSORTED_SCOPE, prKeys: unassigned.filter((key) => threads.has(key) || found.has(key)) };
    return [...topics, unsorted];
  }

  /**
   * Unanswered loud personal asks without an override on open PRs, read or
   * not, wherever the cursor is: the asks whose turn would still call your
   * move. Asks judged before 2026-09-29 sit behind the cursor, judged by a
   * prompt that did not say "thanks" asks nothing, so the first full sync
   * after the upgrade sends them once more (REJUDGE_ASKS_KEY).
   */
  private stuckAsks(prKeys: PrKey[]): PrEvent[] {
    const { store, viewer } = this.deps;
    const events = store.events.listForPrs(prKeys);
    const open = [...store.prs.getMany(prKeys).values()].filter((pr) => pr.state === 'OPEN');
    return open.flatMap((pr) =>
      (events.get(pr.key) ?? []).filter((event) => event.override === null && isUnansweredAsk(pr, events.get(pr.key) ?? [], event, viewer, PERSONAL_ASK_KINDS)),
    );
  }

  /**
   * Events without an override that need an opinion (needsOpinion), logged
   * after afterSeq, per PR. With `rejudge`, the stuck asks too.
   */
  private items(prKeys: PrKey[], afterSeq: number, rejudge: boolean): EventItem[] {
    const logged = this.deps.store.eventLog.listSince(prKeys, afterSeq).map((entry) => entry.event);
    const events = logged.filter(needsOpinion);
    if (rejudge) {
      const ids = new Set(events.map((event) => event.id));
      events.push(...this.stuckAsks(prKeys).filter((event) => !ids.has(event.id)));
      events.sort((a, b) => (a.at < b.at ? -1 : 1));
    }
    const byPr = new Map<PrKey, PrEvent[]>();
    for (const event of events) {
      const list = byPr.get(event.prKey) ?? [];
      list.push(event);
      byPr.set(event.prKey, list);
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

  /** When a batch was skipped or failed, the cursor (and the group's re-judge key) stays put. */
  private async runGroup(group: EventGroup, toSeq: number, rejudge: boolean): Promise<void> {
    const { store } = this.deps;
    const cursorSeq = store.cursors.get('classify', group.scope)?.seq ?? 0;
    const batches = chunk(this.items(group.prKeys, cursorSeq, rejudge), EVENT_BATCH_PRS);
    const done = await Promise.all(batches.map((batch) => this.classify(group.topicId, batch)));
    if (!done.every(Boolean)) {
      return;
    }
    const updatedAt = this.deps.now().toISOString();
    store.cursors.advance({ kind: 'classify', scope: group.scope, seq: toSeq, dossierVersion: null, updatedAt });
    if (rejudge) {
      store.meta.set(rejudgeKey(group), updatedAt);
    }
  }

  /**
   * Every topic and Unsorted, or only the scope's (a glance catch-up run).
   * Full runs re-judge the stuck asks of each group that has not done it
   * yet; a capped or failed group tries again on the next sync, the others
   * do not send theirs again. Once every group did, the global flag ends it.
   */
  async run(scope: TopicScope | null = null): Promise<void> {
    const { store } = this.deps;
    // Taken once up front: events logged while calls run are left for the next sync.
    const toSeq = store.eventLog.maxSeq();
    const rejudgeOpen = scope === null && store.meta.get(REJUDGE_ASKS_KEY) === null;
    const groups = this.groups().filter((group) => scope === null || group.topicId === scope.topicId);
    const rejudged = (group: EventGroup) => store.meta.get(rejudgeKey(group)) !== null;
    await Promise.all(groups.map((group) => this.runGroup(group, toSeq, rejudgeOpen && !rejudged(group))));
    if (rejudgeOpen && groups.every(rejudged)) {
      store.meta.set(REJUDGE_ASKS_KEY, this.deps.now().toISOString());
    }
  }
}
