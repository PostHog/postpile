import type { EventBatchInput, EventOverrideProposal } from '@postpile/agent';
import { awaitsJudgement, isUnansweredAsk, PERSONAL_ASK_KINDS, type Pr, type PrEvent, type PrKey } from '@postpile/core';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps, TopicScope } from './deps.ts';

/** PRs per event classification call. */
export const EVENT_BATCH_PRS = 20;

/**
 * Unread PR threads whose older quiet activity (logged before the classify
 * cursor, so never judged) one full sync sends to the events agent at most,
 * newest first. Keeps the first run on a big inbox from turning into one
 * call per topic; the rest follow on later syncs.
 */
export const JUDGE_BACKLOG_PRS = 40;

/** The override a person's quiet event gets when the events agent saw it and left it quiet. */
export const JUDGED_QUIET_REASON = 'nothing here needs you';

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

/** The items of one call, and which of their events were sent only to be judged for clearing. */
interface EventWork {
  items: EventItem[];
  judging: Set<string>;
}

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
 * wrong "loud" costs the user a ping (and, on an ask, a "your move"
 * footer), a wrong "quiet" is still visible as a dot. Since 2026-09-30 also
 * people's quiet activity on threads unread on GitHub (DESIGN.md "GitHub
 * unread is PostPile unread"): left quiet it is marked judged and PostPile
 * may clear the thread by itself; raised to loud it pings like any loud
 * news. One call per topic (20 PRs at most). The agent may demote (or
 * mute) with a reason; the override is stored on the event.
 *
 * Driven by the event log, not by this sync's new events: every topic has a
 * classify cursor that only moves once all its batches ran. Batches the call
 * cap skips wait for the next sync instead of being lost.
 */
export class EventBatchClassifier {
  /** PRs whose backlog of quiet activity this run judges (`JUDGE_BACKLOG_PRS`), set by `run`. */
  private backlogKeys = new Set<PrKey>();

  constructor(private readonly deps: DigestDeps) {}

  /** PRs with a thread unread on GitHub, newest thread first. */
  private unreadThreadKeys(prKeys: PrKey[]): PrKey[] {
    return [...this.deps.store.notifications.getByPrKeys(prKeys).entries()]
      .filter(([, thread]) => thread.unread)
      .sort(([, a], [, b]) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map(([key]) => key);
  }

  /** People's quiet activity on the PR the judged quiet read waits on (`awaitsJudgement`). */
  private awaiting(pr: Pr, events: PrEvent[]): PrEvent[] {
    return events.filter((event) => awaitsJudgement(event, pr, this.deps.viewer));
  }

  /** The PRs, newest unread thread first, with quiet activity nobody judged yet: at most JUDGE_BACKLOG_PRS. */
  private judgeBacklog(prKeys: PrKey[]): Set<PrKey> {
    const { store } = this.deps;
    const unread = this.unreadThreadKeys(prKeys);
    const prs = store.prs.getMany(unread);
    const events = store.events.listForPrs(unread);
    const waiting = unread.filter((key) => {
      const pr = prs.get(key);
      return pr !== undefined && this.awaiting(pr, events.get(key) ?? []).length > 0;
    });
    return new Set(waiting.slice(0, JUDGE_BACKLOG_PRS));
  }

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
   * People's quiet activity on the group's unread threads, for the judged
   * quiet read: what was logged after the cursor, and on the backlog PRs
   * (`judgeBacklog`) everything nobody judged yet.
   */
  private judgingEvents(prKeys: PrKey[], logged: PrEvent[]): PrEvent[] {
    const { store } = this.deps;
    const unread = new Set(this.unreadThreadKeys(prKeys));
    const prs = store.prs.getMany([...unread]);
    const fresh = logged.filter((event) => {
      const pr = prs.get(event.prKey);
      return unread.has(event.prKey) && pr !== undefined && awaitsJudgement(event, pr, this.deps.viewer);
    });
    const backlog = [...unread].filter((key) => this.backlogKeys.has(key));
    const stored = store.events.listForPrs(backlog);
    const older = backlog.flatMap((key) => {
      const pr = prs.get(key);
      return pr ? this.awaiting(pr, stored.get(key) ?? []) : [];
    });
    const ids = new Set(fresh.map((event) => event.id));
    return [...fresh, ...older.filter((event) => !ids.has(event.id))];
  }

  /**
   * Events without an override that need an opinion (needsOpinion), logged
   * after afterSeq, per PR. With `rejudge`, the stuck asks too. Plus people's
   * quiet activity on unread threads (`judgingEvents`), marked in `judging`.
   */
  private work(prKeys: PrKey[], afterSeq: number, rejudge: boolean): EventWork {
    const logged = this.deps.store.eventLog.listSince(prKeys, afterSeq).map((entry) => entry.event);
    const events = logged.filter(needsOpinion);
    const ids = new Set(events.map((event) => event.id));
    if (rejudge) {
      const stuck = this.stuckAsks(prKeys).filter((event) => !ids.has(event.id));
      stuck.forEach((event) => ids.add(event.id));
      events.push(...stuck);
    }
    // A judging event may be up for an opinion anyway (a push after approval); it is sent once.
    const judging = this.judgingEvents(prKeys, logged);
    events.push(...judging.filter((event) => !ids.has(event.id)));
    events.sort((a, b) => (a.at < b.at ? -1 : 1));
    const byPr = new Map<PrKey, PrEvent[]>();
    for (const event of events) {
      const list = byPr.get(event.prKey) ?? [];
      list.push(event);
      byPr.set(event.prKey, list);
    }
    const prs = this.deps.store.prs.getMany([...byPr.keys()]);
    const items = [...byPr].flatMap(([key, events]) => {
      const pr = prs.get(key);
      return pr ? [{ pr, events }] : [];
    });
    return { items, judging: new Set(judging.map((event) => event.id)) };
  }

  /**
   * The poll decided these events while they were quiet (a push after
   * approval starts quiet). Raised to loud they may wake a snooze or ask
   * the viewer, so their ping decision runs again (`onEventsRaised`).
   */
  private async pingRaised(items: EventItem[], overrides: EventOverrideProposal[]): Promise<void> {
    const onEventsRaised = this.deps.onEventsRaised;
    if (!onEventsRaised) {
      return;
    }
    const byId = new Map(items.flatMap((item) => item.events).map((event) => [event.id, event]));
    const raised = overrides.flatMap((override) => {
      const event = byId.get(override.eventId);
      return event && override.loudness === 'loud' && event.ruleLoudness !== 'loud' ? [event] : [];
    });
    if (raised.length === 0) {
      return;
    }
    try {
      this.deps.errors.push(...(await onEventsRaised(raised)));
    } catch (error) {
      this.deps.errors.push(`raised pings: ${errorText(error)}`);
    }
  }

  /**
   * False when the budget skipped the call or it failed, so the topic's
   * cursor stays put. A judging event the agent left out of its answer was
   * judged quiet: it gets a quiet override, which is what makes it clearable
   * (`judgedReadCheck`) and keeps it from being sent again.
   */
  private async classify(topicId: string | null, items: EventItem[], judging: Set<string>): Promise<boolean> {
    const { store } = this.deps;
    if (!this.deps.budget.take('event_classification')) {
      return false;
    }
    let overrides: EventOverrideProposal[];
    try {
      overrides = await this.deps.agent.classifyEventBatch({
        topic: topicId === null ? null : store.topics.get(topicId),
        items,
        viewer: this.deps.viewer,
        context: this.deps.contexts.forTopic(topicId),
      });
      const answered = new Set(overrides.map((override) => override.eventId));
      const sent = items.flatMap((item) => item.events.map((event) => event.id));
      store.transaction(() => {
        for (const override of overrides) {
          store.events.setOverride(override.eventId, { loudness: override.loudness, reason: override.reason, by: 'agent' });
        }
        for (const id of sent.filter((eventId) => judging.has(eventId) && !answered.has(eventId))) {
          store.events.setOverride(id, { loudness: 'quiet', reason: JUDGED_QUIET_REASON, by: 'agent' });
        }
      });
    } catch (error) {
      this.deps.errors.push(`events ${topicId ?? 'unsorted'}: ${errorText(error)}`);
      return false;
    }
    await this.pingRaised(items, overrides);
    return true;
  }

  /** When a batch was skipped or failed, the cursor (and the group's re-judge key) stays put. */
  private async runGroup(group: EventGroup, toSeq: number, rejudge: boolean): Promise<void> {
    const { store } = this.deps;
    const cursorSeq = store.cursors.get('classify', group.scope)?.seq ?? 0;
    const work = this.work(group.prKeys, cursorSeq, rejudge);
    const batches = chunk(work.items, EVENT_BATCH_PRS);
    const done = await Promise.all(batches.map((batch) => this.classify(group.topicId, batch, work.judging)));
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
    this.backlogKeys = this.judgeBacklog(groups.flatMap((group) => group.prKeys));
    const rejudged = (group: EventGroup) => store.meta.get(rejudgeKey(group)) !== null;
    await Promise.all(groups.map((group) => this.runGroup(group, toSeq, rejudgeOpen && !rejudged(group))));
    if (rejudgeOpen && groups.every(rejudged)) {
      store.meta.set(REJUDGE_ASKS_KEY, this.deps.now().toISOString());
    }
  }
}
