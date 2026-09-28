import { describe, expect, it } from 'vitest';
import type { PrSet, PrSummary, TileView } from '@code-manager/core';
import { at } from '@code-manager/core/fixtures';
import { countPrs, kindLabel, leadPr, tileForYou } from './tiles.ts';

function summary(number: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: `PostHog/posthog#${number}`,
    title: `PR ${number}`,
    url: '',
    author: 'rowan',
    state: 'OPEN',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    tier: 'to_review',
    authorRelation: 'team',
    status: { lifecycle: 'open', review: 'review', checks: 'ok' },
    openThreads: 0,
    verdict: 'LOOKS_SAFE',
    glanceStale: false,
    forYou: `for you ${number}`,
    glanceGap: null,
    unseenLoudEvents: 0,
    updatedAt: at(number),
    ...overrides,
  };
}

function setView(prs: PrSummary[], unreadKeys: string[] = []): TileView {
  return {
    tile: { id: 'set:s1', topicId: 't1', kind: 'set', title: 'Cache PRs', members: [] },
    state: {
      kind: unreadKeys.length > 0 ? 'unread' : 'open',
      unreadBecause: unreadKeys.map((prKey, index) => ({ prKey, eventId: `e${index}`, kind: 'mention', actor: 'lyra', summary: 'x', at: at(index) })),
    },
    prs,
    why: 'RV',
    tier: 'to_review',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
  };
}

const pulled = { kind: 'pulled_in', reason: 'same cache keys' } as const;

describe('tile helpers', () => {
  it('picks the PR behind the newest unread reason as the lead', () => {
    const view = setView([summary(1), summary(2), summary(3)], ['PostHog/posthog#1', 'PostHog/posthog#3']);
    expect(leadPr(view)?.key).toBe('PostHog/posthog#3');
  });

  it('falls back to the first open pinged PR', () => {
    const view = setView([summary(1, { provenance: pulled }), summary(2, { state: 'MERGED' }), summary(3)]);
    expect(leadPr(view)?.key).toBe('PostHog/posthog#3');
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
    expect(countPrs([first, second])).toEqual({ pinged: 2, pulledIn: 1 });
  });
});
