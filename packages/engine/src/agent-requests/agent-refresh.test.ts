import type { ActionOutcome, PrKey, TileView, TopicDetail } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { GitHubQuota } from '../github-quota.ts';
import { AgentRefresher, type RefreshRun, type StoredPrInfo } from './agent-refresh.ts';

const T0 = Date.parse('2026-09-29T12:00:00Z');

interface Setup {
  refresher: AgentRefresher;
  prs: Map<PrKey, StoredPrInfo>;
  events: Map<PrKey, number>;
  reads: PrKey[][];
  logs: [ActionOutcome, string][];
  quota: GitHubQuota;
  setNow: (ms: number) => void;
  /** What the next read does; by default it fetches every PR and adds an event to the first. */
  onRead: (keys: PrKey[]) => Promise<RefreshRun>;
}

function tile(keys: PrKey[], attention: boolean): TileView {
  return {
    state: { kind: attention ? 'unread' : 'open', unreadBecause: [] },
    turn: { kind: 'none', who: null, what: '', prKey: null },
    prs: keys.map((key) => ({ key, state: 'OPEN' })),
  } as unknown as TileView;
}

function setup(): Setup {
  let now = T0;
  const prs = new Map<PrKey, StoredPrInfo>();
  const events = new Map<PrKey, number>();
  const reads: PrKey[][] = [];
  const logs: [ActionOutcome, string][] = [];
  const quota = new GitHubQuota(() => now);
  const topic = {
    topic: { id: 'depot', status: 'active' },
    tiles: [tile(['acme/app#1', 'acme/app#2'], false), tile(['acme/app#3'], true)],
  } as unknown as TopicDetail;
  const state: Setup = {
    prs,
    events,
    reads,
    logs,
    quota,
    setNow: (ms) => (now = ms),
    onRead: async (keys) => {
      for (const key of keys) {
        prs.set(key, { ...(prs.get(key) as StoredPrInfo), fetchedAt: new Date(now).toISOString() });
      }
      const first = keys[0] as PrKey;
      events.set(first, (events.get(first) ?? 0) + 1);
      return { kind: 'ran' };
    },
    refresher: undefined as unknown as AgentRefresher,
  };
  state.refresher = new AgentRefresher({
    now: () => new Date(now),
    quota,
    pr: (key) => prs.get(key) ?? null,
    topic: async (topicId) => (topicId === 'depot' ? topic : null),
    eventCounts: (keys) => new Map(keys.map((key) => [key, events.get(key) ?? 0])),
    read: (keys) => {
      reads.push(keys);
      return state.onRead(keys);
    },
    log: (outcome, detail) => logs.push([outcome, detail]),
  });
  for (const [number, updatedAt] of [[1, '2026-09-20'], [2, '2026-09-28'], [3, '2026-09-10']] as const) {
    prs.set(`acme/app#${number}`, { fetchedAt: '2026-09-29T11:00:00.000Z', updatedAt, state: 'OPEN' });
  }
  return state;
}

describe('AgentRefresher', () => {
  it('reads one PR and says what came back with news', async () => {
    const s = setup();
    const result = await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code');
    expect(result).toMatchObject({ status: 'done', prKeys: ['acme/app#1'], fetched: ['acme/app#1'], changed: ['acme/app#1'], fresh: [] });
    expect(s.logs).toEqual([['github', 'claude-code: 1 PRs, 1 fetched, 1 with news, 0 fresh (acme/app#1)']]);
  });

  it('refuses PRs it does not track, without a retry time', async () => {
    const s = setup();
    const result = await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#99' }, 'claude-code');
    expect(result).toMatchObject({ status: 'blocked', retryAt: null, reason: 'PostPile does not track acme/app#99; it only refreshes PRs it tracks.' });
    expect(s.reads).toEqual([]);
    expect(s.logs[0]?.[0]).toBe('skipped');
  });

  it('skips PRs fetched in the last minute and reads nothing when all are fresh', async () => {
    const s = setup();
    s.prs.set('acme/app#1', { ...(s.prs.get('acme/app#1') as StoredPrInfo), fetchedAt: new Date(T0 - 25_000).toISOString() });
    const result = await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code');
    expect(result).toMatchObject({ status: 'done', fetched: [], fresh: [{ prKey: 'acme/app#1', fetchedAt: new Date(T0 - 25_000).toISOString() }] });
    expect(s.reads).toEqual([]);
  });

  it('refreshes a topic: unread and your move first, then the newest', async () => {
    const s = setup();
    await s.refresher.refresh({ kind: 'topic', topicId: 'depot' }, 'claude-code');
    expect(s.reads).toEqual([['acme/app#3', 'acme/app#2', 'acme/app#1']]);
    expect((await s.refresher.refresh({ kind: 'topic', topicId: 'gone' }, 'claude-code')).reason).toBe('PostPile has no active topic gone.');
  });

  it('lets only single PRs through while the quota is low, and nothing while it is critical', async () => {
    const s = setup();
    const resetAtMs = T0 + 30 * 60_000;
    s.quota.note({ resource: 'graphql', limit: 5000, remaining: 2000, resetAtMs });
    const topic = await s.refresher.refresh({ kind: 'topic', topicId: 'depot' }, 'claude-code');
    expect(topic).toMatchObject({ status: 'blocked', retryAt: new Date(resetAtMs).toISOString() });
    expect(topic.reason).toContain('only single-PR refreshes run');
    expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code')).status).toBe('done');

    s.quota.note({ resource: 'graphql', limit: 5000, remaining: 500, resetAtMs });
    const pr = await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#2' }, 'claude-code');
    expect(pr).toMatchObject({ status: 'blocked', retryAt: new Date(resetAtMs).toISOString() });
    expect(pr.reason).toContain('nearly used');
  });

  it('allows 20 reads an hour, then says when the next one is possible', async () => {
    const s = setup();
    for (let i = 0; i < 20; i += 1) {
      s.setNow(T0 + i * 61_000);
      expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code')).status).toBe('done');
    }
    s.setNow(T0 + 20 * 61_000);
    const capped = await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#2' }, 'claude-code');
    expect(capped).toMatchObject({ status: 'blocked', retryAt: new Date(T0 + 3600_000).toISOString() });
    s.setNow(T0 + 3600_000);
    expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#2' }, 'claude-code')).status).toBe('done');
  });

  it('uses no hourly slot for a read the app could not make', async () => {
    const s = setup();
    s.onRead = async () => ({ kind: 'blocked', reason: 'setup not finished', retryAt: null });
    for (let i = 0; i < 25; i += 1) {
      expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code')).status).toBe('blocked');
    }
    s.onRead = async () => ({ kind: 'ran' });
    for (let i = 0; i < 20; i += 1) {
      s.setNow(T0 + i * 61_000);
      expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#2' }, 'claude-code')).status).toBe('done');
    }
    s.setNow(T0 + 20 * 61_000);
    expect((await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#3' }, 'claude-code')).reason).toContain('20 refreshes in the last hour');
  });

  it('runs one refresh at a time', async () => {
    const s = setup();
    let release: () => void = () => {};
    let running = 0;
    let most = 0;
    s.onRead = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => (release = resolve));
      running -= 1;
      return { kind: 'ran' };
    };
    const first = s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'a');
    const second = s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#2' }, 'b');
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([first, second]);
    expect(most).toBe(1);
    expect(s.reads).toEqual([['acme/app#1'], ['acme/app#2']]);
  });

  it('passes on why the app could not read', async () => {
    const s = setup();
    s.onRead = async () => ({ kind: 'blocked', reason: 'setup not finished', retryAt: null });
    expect(await s.refresher.refresh({ kind: 'pr', prKey: 'acme/app#1' }, 'claude-code')).toMatchObject({ status: 'blocked', reason: 'setup not finished' });
  });
});
