import { describe, expect, it } from 'vitest';
import type { PrSet, PrSummary, TileView } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { countPrs, isDraftTile, isFyiNews, kindLabel, leadPr, tileForYou } from './tiles.ts';

function summary(number: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: `acme/app#${number}`,
    title: `PR ${number}`,
    url: '',
    author: 'rowan',
    state: 'OPEN',
    primaryAction: 'approve',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    authorRelation: 'team',
    status: { lifecycle: 'open', review: 'review', checks: 'ok', agentApprovers: [] },
    openThreads: 0,
    verdict: 'LOOKS_SAFE',
    glanceStale: false,
    forYou: `for you ${number}`,
    glanceGap: null,
    unseenLoudEvents: 0,
    updatedAt: at(number),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function setView(prs: PrSummary[], unreadKeys: string[] = []): TileView {
  return {
    tile: { id: 'set:s1', topicId: 't1', kind: 'set', title: 'Cache PRs', members: [], stacks: [] },
    state: {
      kind: unreadKeys.length > 0 ? 'unread' : 'open',
      unreadBecause: unreadKeys.map((prKey, index) => ({ prKey, eventId: `e${index}`, kind: 'mention', actor: 'lyra', summary: 'x', at: at(index) })),
    },
    prs,
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  };
}

const pulled = { kind: 'pulled_in', reason: 'same cache keys' } as const;

describe('own PR helpers', () => {
  const mine = (number: number) => summary(number, { authorRelation: 'you' });

  it('calls news on your own PR FYI unless whose-turn says it is your move', () => {
    const view = setView([mine(1)], ['acme/app#1']);
    expect(isFyiNews(view)).toBe(true);
    expect(isFyiNews({ ...view, turn: { kind: 'you', who: null, what: 'Answer 1 thread', prKey: 'acme/app#1' } })).toBe(false);
    expect(isFyiNews(setView([summary(1)], ['acme/app#1']))).toBe(false);
    expect(isFyiNews(setView([mine(1)]))).toBe(false);
  });
});

describe('isDraftTile', () => {
  it('is a draft tile when every open tracked PR is a draft', () => {
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2, { isDraft: true, provenance: pulled })]))).toBe(true);
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2)]))).toBe(false);
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2, { state: 'MERGED' })]))).toBe(true);
    expect(isDraftTile(setView([summary(1, { state: 'MERGED' })]))).toBe(false);
  });
});

describe('tile helpers', () => {
  it('picks the PR behind the newest unread reason as the lead', () => {
    const view = setView([summary(1), summary(2), summary(3)], ['acme/app#1', 'acme/app#3']);
    expect(leadPr(view)?.key).toBe('acme/app#3');
  });

  it('falls back to the first open pinged PR', () => {
    const view = setView([summary(1, { provenance: pulled }), summary(2, { state: 'MERGED' }), summary(3)]);
    expect(leadPr(view)?.key).toBe('acme/app#3');
  });

  it('labels kinds', () => {
    const view = setView([summary(1), summary(2, { provenance: pulled }), summary(3, { provenance: pulled })]);
    expect(kindLabel(view)).toBe('Set · 3');
  });

  it('uses the set take for set tiles and the lead for_you otherwise', () => {
    const view = setView([summary(1)]);
    const set = { id: 's1', take: 'All three touch Turbo cache keys.' } as PrSet;
    expect(tileForYou(view, [set])).toBe('All three touch Turbo cache keys.');
    expect(tileForYou(view, [])).toBe('for you 1');
  });

  it('counts a PR pinged in any tile as pinged, once', () => {
    const first = setView([summary(1), summary(2, { provenance: pulled })]);
    const second = setView([summary(2), summary(3, { provenance: pulled })]);
    expect(countPrs([first, second])).toEqual({ pinged: 2, found: 0, pulledIn: 1 });
  });

  it('counts found PRs apart, unless pinged elsewhere', () => {
    const found = { kind: 'found' as const, via: 'own_open' as const, reason: 'your open PR' };
    const view = setView([summary(1, { provenance: found }), summary(2), summary(3, { provenance: pulled })]);
    expect(countPrs([view])).toEqual({ pinged: 1, found: 1, pulledIn: 1 });
    expect(leadPr(setView([summary(4, { provenance: pulled, state: 'OPEN' }), summary(5, { provenance: found })]))?.key).toBe('acme/app#5');
  });
});
