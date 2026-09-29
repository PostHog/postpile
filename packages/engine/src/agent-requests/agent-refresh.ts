import {
  AGENT_REFRESH_FRESH_MS,
  AGENT_REFRESH_TOPIC_MAX_PRS,
  AGENT_REFRESHES_PER_HOUR,
  quotaPercent,
  type ActionOutcome,
  type AgentRefreshResult,
  type AgentRefreshTarget,
  type IsoTime,
  type PrKey,
  type PrState,
  type TileView,
  type TopicDetail,
} from '@postpile/core';
import type { GitHubQuota } from '../github-quota.ts';

const HOUR_MS = 3600_000;

/** How the app's GitHub read went: a poll cycle of its own, a running full sync joined, or nothing read. */
export type RefreshRun = { kind: 'ran' } | { kind: 'joined_sync' } | { kind: 'blocked'; reason: string; retryAt: IsoTime | null };

/** What the refresh needs to know about one stored PR. */
export interface StoredPrInfo {
  fetchedAt: IsoTime | null;
  updatedAt: IsoTime;
  state: PrState;
}

export interface AgentRefreshDeps {
  now: () => Date;
  /** The app's GitHub quota: the gate for how much an agent may read. */
  quota: GitHubQuota;
  /** The stored PR, or null when PostPile does not track it. */
  pr: (key: PrKey) => StoredPrInfo | null;
  topic: (topicId: string) => Promise<TopicDetail | null>;
  /** How many events each PR has stored; a PR whose count grows came back with news. */
  eventCounts: (keys: PrKey[]) => Map<PrKey, number>;
  /** Reads these PRs from GitHub now (the engine's refreshNow). */
  read: (keys: PrKey[]) => Promise<RefreshRun>;
  /** One action log line per request (agent_refresh). */
  log: (outcome: ActionOutcome, detail: string) => void;
}

function blocked(prKeys: PrKey[], reason: string, retryAt: IsoTime | null): AgentRefreshResult {
  return { status: 'blocked', prKeys, fetched: [], changed: [], fresh: [], joinedSync: false, reason, retryAt };
}

function isoAt(ms: number): IsoTime {
  return new Date(ms).toISOString();
}

/** Unread tiles and the user's move first: those are the PRs an agent most likely asks about. */
function wantsAttention(view: TileView): boolean {
  return view.state.kind === 'unread' || view.turn.kind === 'you';
}

/**
 * refresh_from_github on the app side (DESIGN.md "refresh_from_github"):
 * picks the PRs, skips fresh ones, and enforces the shared GitHub budget.
 * Every Claude session runs its own MCP process, but they all share the
 * user's one GitHub quota, so the limits live here: fresh PRs are skipped,
 * at most AGENT_REFRESHES_PER_HOUR reads an hour and one at a time, a topic
 * only while the quota is ok, nothing while it is critical. Every refusal
 * says when to try again. GitHub reads only, never a write.
 */
export class AgentRefresher {
  /** When each refresh that read GitHub started, for the hourly cap. */
  private readonly readTimes: number[] = [];
  /** The refresh running now; the next one waits for it. */
  private running: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: AgentRefreshDeps) {}

  /** Serialized: a second agent's refresh waits for the first, then usually finds its PRs fresh. */
  refresh(target: AgentRefreshTarget, client: string): Promise<AgentRefreshResult> {
    const next = this.running.then(() => this.refreshOnce(target, client));
    this.running = next.catch(() => {});
    return next;
  }

  /** A topic's open PRs: unread and the user's move first, then the newest, at most AGENT_REFRESH_TOPIC_MAX_PRS. */
  private async topicPrs(topicId: string): Promise<PrKey[] | string> {
    const topic = await this.deps.topic(topicId);
    if (!topic || topic.topic.status !== 'active') {
      return `PostPile has no active topic ${topicId}.`;
    }
    const first = new Map<PrKey, boolean>();
    for (const view of topic.tiles) {
      for (const pr of view.prs) {
        if (pr.state === 'OPEN') {
          first.set(pr.key, (first.get(pr.key) ?? false) || wantsAttention(view));
        }
      }
    }
    const updatedAt = (key: PrKey): string => this.deps.pr(key)?.updatedAt ?? '';
    return [...first.keys()]
      .sort((a, b) => Number(first.get(b)) - Number(first.get(a)) || updatedAt(b).localeCompare(updatedAt(a)))
      .slice(0, AGENT_REFRESH_TOPIC_MAX_PRS);
  }

  private async targetPrs(target: AgentRefreshTarget): Promise<PrKey[] | string> {
    if (target.kind === 'topic') {
      return this.topicPrs(target.topicId);
    }
    return this.deps.pr(target.prKey) ? [target.prKey] : `PostPile does not track ${target.prKey}; it only refreshes PRs it tracks.`;
  }

  /** Why the quota does not allow this refresh now, with the reset time; null when it does. */
  private quotaRefusal(target: AgentRefreshTarget, prKeys: PrKey[]): AgentRefreshResult | null {
    const state = this.deps.quota.state();
    const worst = state.worst;
    const left = worst ? `${worst.resource} ${quotaPercent(worst.remaining, worst.limit)}% left` : '';
    if (state.level === 'critical') {
      const retryAt = isoAt(state.pollResumeAtMs ?? this.deps.now().getTime() + HOUR_MS);
      return blocked(prKeys, `The user's GitHub quota is nearly used (${left}); PostPile reads nothing more until it resets at ${retryAt}.`, retryAt);
    }
    if (state.level === 'low' && target.kind === 'topic') {
      const retryAt = isoAt(state.backgroundResumeAtMs ?? this.deps.now().getTime() + HOUR_MS);
      return blocked(prKeys, `The user's GitHub quota is low (${left}); only single-PR refreshes run until it resets at ${retryAt}. Refresh one PR instead.`, retryAt);
    }
    return null;
  }

  /** The hourly cap, counted over reads that reached GitHub; null while there is room. */
  private capRefusal(prKeys: PrKey[]): AgentRefreshResult | null {
    const now = this.deps.now().getTime();
    while (this.readTimes.length > 0 && (this.readTimes[0] ?? 0) <= now - HOUR_MS) {
      this.readTimes.shift();
    }
    if (this.readTimes.length < AGENT_REFRESHES_PER_HOUR) {
      return null;
    }
    const retryAt = isoAt((this.readTimes[0] ?? now) + HOUR_MS);
    return blocked(prKeys, `Agents already asked for ${AGENT_REFRESHES_PER_HOUR} refreshes in the last hour; the next one is possible at ${retryAt}.`, retryAt);
  }

  private async refreshOnce(target: AgentRefreshTarget, client: string): Promise<AgentRefreshResult> {
    const picked = await this.targetPrs(target);
    if (typeof picked === 'string') {
      return this.logged(client, blocked([], picked, null));
    }
    if (picked.length === 0) {
      return this.logged(client, { status: 'done', prKeys: [], fetched: [], changed: [], fresh: [], joinedSync: false, reason: null, retryAt: null });
    }
    const refusal = this.quotaRefusal(target, picked);
    if (refusal) {
      return this.logged(client, refusal);
    }
    const nowMs = this.deps.now().getTime();
    const fresh: AgentRefreshResult['fresh'] = [];
    const stale: PrKey[] = [];
    for (const key of picked) {
      const fetchedAt = this.deps.pr(key)?.fetchedAt ?? null;
      if (fetchedAt !== null && nowMs - Date.parse(fetchedAt) < AGENT_REFRESH_FRESH_MS) {
        fresh.push({ prKey: key, fetchedAt });
      } else {
        stale.push(key);
      }
    }
    if (stale.length === 0) {
      return this.logged(client, { status: 'done', prKeys: picked, fetched: [], changed: [], fresh, joinedSync: false, reason: null, retryAt: null });
    }
    const capped = this.capRefusal(picked);
    if (capped) {
      return this.logged(client, capped);
    }
    this.readTimes.push(nowMs);
    const fetchedBefore = new Map(stale.map((key) => [key, this.deps.pr(key)?.fetchedAt ?? null]));
    const eventsBefore = this.deps.eventCounts(stale);
    const run = await this.deps.read(stale);
    if (run.kind === 'blocked') {
      return this.logged(client, { ...blocked(picked, run.reason, run.retryAt), fresh });
    }
    const fetched = stale.filter((key) => (this.deps.pr(key)?.fetchedAt ?? null) !== fetchedBefore.get(key));
    const eventsAfter = this.deps.eventCounts(fetched);
    const changed = fetched.filter((key) => (eventsAfter.get(key) ?? 0) > (eventsBefore.get(key) ?? 0));
    return this.logged(client, { status: 'done', prKeys: picked, fetched, changed, fresh, joinedSync: run.kind === 'joined_sync', reason: null, retryAt: null });
  }

  /** "claude-code: 3 PRs, 2 fetched, 1 with news, 1 fresh" or "claude-code: blocked: …". */
  private logged(client: string, result: AgentRefreshResult): AgentRefreshResult {
    if (result.status === 'blocked') {
      this.deps.log('skipped', `${client}: blocked: ${result.reason ?? ''}`);
      return result;
    }
    const parts = [`${result.prKeys.length} PRs`, `${result.fetched.length} fetched`, `${result.changed.length} with news`, `${result.fresh.length} fresh`];
    if (result.joinedSync) {
      parts.push('joined the running sync');
    }
    const keys = result.prKeys.length > 0 ? ` (${result.prKeys.join(', ')})` : '';
    this.deps.log(result.fetched.length > 0 || result.joinedSync ? 'github' : 'skipped', `${client}: ${parts.join(', ')}${keys}`);
    return result;
  }
}
