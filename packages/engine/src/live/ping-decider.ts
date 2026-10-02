import { EVENTS_PER_PING_ITEM, type AgentService, type PingDecisionAnswer, type PingDecisionItem } from '@postpile/agent';
import {
  dossierBrief,
  isLiveConversation,
  isMemoryNoise,
  isPersonalPing,
  isPrInQuietRepo,
  pingRule,
  pingTemplate,
  whoseTurn,
  whyHere,
  type Ping,
  type PingDecision,
  type PingRule,
  type PingTarget,
  type Pr,
  type PrEvent,
  type PrKey,
  type Tile,
  type Viewer,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { errorText } from '../errors.ts';
import { loadRepoSettings } from '../repo-settings.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { placeOnBoard } from './ping-target.ts';

/** Ping decisions per rolling 24 hours. One sonnet call per poll cycle with news, whatever the batch size. */
export const PING_DECISIONS_PER_DAY = 200;

/**
 * Only events this fresh ping. A PR fetched late (a failed poll, the app
 * was closed) brings older events along; those are news for the tile, not
 * for an interruption.
 */
export const PING_FRESH_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PingDeciderDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  now: () => Date;
  /** PING_DECISIONS_PER_DAY unless POSTPILE_PING_CAP says otherwise. */
  capPerDay: number;
  /** The claude headline while the agent is off: the rules decide then, like over the cap. Missing: always on. */
  agentOff?: () => string | null;
}

export interface PingDecisions {
  decisions: PingDecision[];
  pings: Ping[];
  errors: string[];
}

/** A PR with fresh events the rules would ping for, before the agent had its say. */
interface Candidate {
  threadId: string;
  pr: Pr;
  events: PrEvent[];
  rule: PingRule;
  /** `isLiveConversation` for the rule's event: it pings whatever the agent says. */
  conversation: boolean;
  target: PingTarget;
  tile: Tile | null;
}

/** Which of a PR's events count as news for this decision. */
type IsNews = (event: PrEvent) => boolean;

function newestFirst(events: PrEvent[]): PrEvent[] {
  return [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/**
 * Decides per PR thread whether the fast poll's new events ping the Mac.
 * Rules first: muted, quiet, bot-only, loud-but-not-addressed activity and
 * anything in a quiet repo never pings and never reaches the agent.
 * Addressed activity goes to the agent in one call per cycle, which may veto or rephrase. If the agent
 * fails, skips an item or the daily cap is spent, the rules decide: ping
 * with the template text. Every decision is stored in ping_decision.
 */
export class PingDecider {
  /**
   * Fresh events the poll stored while their thread was read, per PR. GitHub
   * often marks a thread unread a cycle after the event shows up on the PR,
   * most of all right after the viewer's own comment made it read; by then
   * the event is no longer new and the PR is not fetched again, so the reply
   * never pinged (seen in the real ping log, 2026-10-02). Decided once the
   * thread turns unread, while still fresh and unseen. Lives as long as the
   * poller, like the throttle.
   */
  private readonly waitingForUnread = new Map<PrKey, Set<string>>();

  constructor(private readonly deps: PingDeciderDeps) {}

  private overCap(): boolean {
    const since = new Date(this.deps.now().getTime() - DAY_MS).toISOString();
    return this.deps.store.agentCalls.countSince('ping_decision', since) >= this.deps.capPerDay;
  }

  /** The tile a click should open: the one in the PR's topic that holds it, pinged there if possible. */
  private locate(board: Board, key: PrKey): { target: PingTarget; tile: Tile | null } {
    const place = placeOnBoard(board, key);
    return { target: { topicId: place?.topicId ?? null, tileId: place?.tile?.id ?? null, prKey: key }, tile: place?.tile ?? null };
  }

  private decision(candidate: Candidate, fields: Pick<PingDecision, 'ping' | 'title' | 'body' | 'reason' | 'source'>): PingDecision {
    return { threadId: candidate.threadId, prKey: candidate.pr.key, at: this.deps.now().toISOString(), ...fields };
  }

  private fallback(candidate: Candidate, why: string): PingDecision {
    const text = pingTemplate(candidate.rule.event!, candidate.pr);
    return this.decision(candidate, { ping: true, ...text, reason: `${why}; rules: ${candidate.rule.reason}`, source: 'fallback' });
  }

  /**
   * The fresh unseen news of a read thread, kept for the cycle that finds it
   * unread. Replaces what was kept, so events that went stale or seen drop out.
   */
  private waitForUnread(key: PrKey, events: PrEvent[]): void {
    if (events.length === 0) {
      this.waitingForUnread.delete(key);
      return;
    }
    this.waitingForUnread.set(key, new Set(events.map((event) => event.id)));
  }

  /** `keepReadNews`: the poll keeps the news of read threads for later (`waitingForUnread`). */
  private candidates(board: Board, prKeys: PrKey[], isNews: (key: PrKey) => IsNews, viewer: Viewer, keepReadNews: boolean): Candidate[] {
    const cutoff = new Date(this.deps.now().getTime() - PING_FRESH_MS).toISOString();
    const settings = loadRepoSettings(this.deps.store);
    const result: Candidate[] = [];
    for (const key of prKeys) {
      const thread = board.threads.get(key);
      const pr = board.prs.get(key);
      if (!thread || !pr) {
        continue;
      }
      const allEvents = board.events.get(key) ?? [];
      const news = isNews(key);
      const events = allEvents.filter((e) => news(e) && e.seenAt === null && e.at >= cutoff);
      if (!thread.unread) {
        if (keepReadNews) {
          this.waitForUnread(key, events);
        }
        continue;
      }
      this.waitingForUnread.delete(key);
      if (events.length === 0) {
        continue;
      }
      const located = this.locate(board, key);
      // New human news wakes a snooze before the board is read, so a tile still snoozed here has nothing that should ping yet. An event the agent raises to loud later comes back through decideRaised.
      const snoozed = located.tile !== null && board.stateOf(located.tile).kind === 'snoozed';
      const rule = pingRule(events, pr, viewer, isPrInQuietRepo(key, settings), snoozed);
      const conversation = rule.class === 'addressed' && rule.event !== null && isLiveConversation(rule.event, pr, allEvents, viewer);
      result.push({ threadId: thread.id, pr, events: newestFirst(events), rule, conversation, ...located });
    }
    return result;
  }

  private item(board: Board, candidate: Candidate, viewer: Viewer): PingDecisionItem {
    const { store, contexts } = this.deps;
    const topicId = candidate.target.topicId;
    const topic = topicId && topicId !== UNSORTED_TOPIC_ID ? store.topics.get(topicId) : null;
    const dossier = topic ? store.dossiers.latest(topic.id) : null;
    const tile = candidate.tile;
    const member = tile?.members.find((m) => m.prKey === candidate.pr.key);
    const turn = tile
      ? whoseTurn({ tile, prs: board.prs, events: board.events, userStates: board.userStates, viewer, notYours: board.notYours })
      : { kind: 'none' as const, who: null, what: '', prKey: null };
    return {
      id: candidate.threadId,
      pr: candidate.pr,
      topicName: topic?.name ?? null,
      tailoring: topic ? contexts.forTopic(topic.id).tailoring : '',
      dossierBrief: dossier ? dossierBrief(dossier.dossier) : '',
      glance: store.glances.get(candidate.pr.key),
      // Noise (CI, a bot refreshing its status comment) would only push the person's words out of the slice.
      events: candidate.events.filter((event) => !isMemoryNoise(event)).slice(0, EVENTS_PER_PING_ITEM),
      rule: {
        loudness: candidate.rule.loudness,
        reason: candidate.rule.reason,
        whoseTurn: turn,
        why: whyHere(member?.provenance ?? { kind: 'pinged', reason: 'subscribed' }, candidate.pr, viewer),
        conversation: candidate.conversation,
      },
      template: pingTemplate(candidate.rule.event!, candidate.pr),
    };
  }

  private async askAgent(board: Board, addressed: Candidate[], viewer: Viewer, errors: string[]): Promise<PingDecision[]> {
    if (this.overCap()) {
      return addressed.map((c) => this.fallback(c, `daily cap of ${this.deps.capPerDay} ping decisions reached`));
    }
    const agentOff = this.deps.agentOff?.() ?? null;
    if (agentOff !== null) {
      return addressed.map((c) => this.fallback(c, agentOff));
    }
    let answers: PingDecisionAnswer[];
    try {
      answers = await this.deps.agent.decidePings({
        items: addressed.map((candidate) => this.item(board, candidate, viewer)),
        viewer,
        context: this.deps.contexts.forTopic(null),
      });
    } catch (error) {
      errors.push(`ping decision: ${errorText(error)}`);
      return addressed.map((c) => this.fallback(c, 'agent failed'));
    }
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    return addressed.map((candidate) => {
      const answer = byId.get(candidate.threadId);
      if (!answer) {
        return this.fallback(candidate, 'agent skipped it');
      }
      return this.fromAgent(candidate, answer);
    });
  }

  /** The agent's answer, except that a live conversation pings even when the agent said no. */
  private fromAgent(candidate: Candidate, answer: PingDecisionAnswer): PingDecision {
    const { ping, title, body, reason } = answer;
    if (ping || !candidate.conversation) {
      return this.decision(candidate, { ping, title, body, reason, source: 'agent' });
    }
    const text = title.trim() === '' ? pingTemplate(candidate.rule.event!, candidate.pr) : { title, body };
    return this.decision(candidate, { ping: true, ...text, reason: `live conversation, pings anyway; agent: ${reason}`, source: 'agent' });
  }

  /**
   * The agent call takes seconds; the user may have read the PR meanwhile
   * (in the app or on github.com). Only a thread that is still unread with
   * at least one of its events still unseen pings.
   */
  private stillNews(candidate: Candidate): boolean {
    const { store } = this.deps;
    if (!store.notifications.get(candidate.threadId)?.unread) {
      return false;
    }
    const ids = new Set(candidate.events.map((event) => event.id));
    return store.events.listForPr(candidate.pr.key).some((event) => ids.has(event.id) && event.seenAt === null);
  }

  private async decideCandidates(board: Board, candidates: Candidate[], viewer: Viewer): Promise<PingDecisions> {
    const { store } = this.deps;
    const errors: string[] = [];
    const addressed = candidates.filter((c) => c.rule.class === 'addressed');
    const quiet = candidates
      .filter((c) => c.rule.class !== 'addressed')
      .map((c) => this.decision(c, { ping: false, title: '', body: '', reason: `${c.rule.class}: ${c.rule.reason}`, source: 'rules' }));
    const decided = addressed.length > 0 ? await this.askAgent(board, addressed, viewer, errors) : [];
    const decisions = [...decided, ...quiet];
    store.transaction(() => {
      for (const decision of decisions) {
        store.pingDecisions.add(decision);
      }
    });
    const byThread = new Map(candidates.map((c) => [c.threadId, c]));
    const pings = decided
      .filter((d) => d.ping && this.stillNews(byThread.get(d.threadId)!))
      .map((d): Ping => {
        const candidate = byThread.get(d.threadId)!;
        return { title: d.title, body: d.body, target: candidate.target, personal: isPersonalPing(candidate.rule.event!, candidate.pr, viewer) };
      });
    return { decisions, pings, errors };
  }

  /** Some read thread's news waits to be decided once GitHub marks it unread: worth a decision even when the poll fetched nothing. */
  hasWaiting(): boolean {
    return this.waitingForUnread.size > 0;
  }

  /**
   * The poll's decision: new events of the fetched PRs, and the events kept
   * from earlier cycles while their thread was still read
   * (`waitingForUnread`), whether or not the PR was fetched again.
   */
  async decide(prKeys: PrKey[], newEventIds: string[], viewer: Viewer): Promise<PingDecisions> {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    const fresh = new Set(newEventIds);
    const keys = [...new Set([...prKeys, ...this.waitingForUnread.keys()])];
    const isNews = (key: PrKey): IsNews => {
      const waiting = this.waitingForUnread.get(key);
      return (event) => fresh.has(event.id) || (waiting?.has(event.id) ?? false);
    };
    return this.decideCandidates(board, this.candidates(board, keys, isNews, viewer, true), viewer);
  }

  /** The thread pinged at or after `at`: the user already heard about this PR since then. */
  private pingedSince(board: Board, key: PrKey, at: string): boolean {
    const thread = board.threads.get(key);
    if (!thread) {
      return false;
    }
    return this.deps.store.pingDecisions.listForThreads([thread.id]).some((decision) => decision.ping && decision.at >= at);
  }

  /**
   * The poll decided these events while they were still quiet; the events
   * agent raised them to loud since (a catch-up run or the next full sync),
   * which may wake a snooze or make them addressed. Their PRs are decided
   * again, with all their fresh unseen events, like in the poll. Only a
   * raised event that is still fresh and unseen counts, and a thread that
   * pinged since the raised event does not ping again.
   */
  async decideRaised(raised: PrEvent[], viewer: Viewer): Promise<PingDecisions> {
    const { store, now } = this.deps;
    const board = Board.load(store, now().toISOString());
    const cutoff = new Date(now().getTime() - PING_FRESH_MS).toISOString();
    const prKeys = new Set<PrKey>();
    for (const event of raised) {
      const stored = (board.events.get(event.prKey) ?? []).find((e) => e.id === event.id);
      if (stored && stored.seenAt === null && stored.at >= cutoff && !this.pingedSince(board, event.prKey, stored.at)) {
        prKeys.add(event.prKey);
      }
    }
    return this.decideCandidates(board, this.candidates(board, [...prKeys], () => () => true, viewer, false), viewer);
  }
}
