import { describe, expect, it } from 'vitest';
import type { PrSummary, TileView } from '@postpile/core';
import { at, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import { tileOpenedProps } from './tile-telemetry.ts';

function summary(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: 'acme/app#1',
    title: 'PR 1',
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
    status: { lifecycle: 'open', review: 'review', agentApprovers: [] },
    openThreads: 0,
    verdict: 'LOOKS_SAFE',
    glanceStale: false,
    forYou: 'for you',
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: { kind: 'none', who: null, what: '', prKey: null },
    facts: NO_PR_FACTS,
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    whatsNew: null,
    updatedAt: at(1),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function view(prs: PrSummary[], forWhom: TileView['forWhom'] = { kind: 'you' }): TileView {
  return withOffers({
    tile: { id: 'pr:acme/app#1', topicId: 't1', kind: 'single', title: 'PR 1', members: [], stacks: [] },
    state: { kind: 'open', unreadBecause: [] },
    prs,
    why: 'RV',
    forWhom,
    tier: 'to_review',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  });
}

describe('tileOpenedProps', () => {
  it('reads the tile kind, the for-whom chip and the lead PR glance', () => {
    expect(tileOpenedProps(view([summary()]))).toEqual({
      tile_kind: 'single',
      for_whom: 'you',
      has_glance: true,
      verdict: 'looks_safe',
    });
  });

  it('maps every ForWhom kind, "own" to "your_pr"', () => {
    expect(tileOpenedProps(view([summary()], { kind: 'team', team: 'acme/devex' })).for_whom).toBe('team');
    expect(tileOpenedProps(view([summary()], { kind: 'own' })).for_whom).toBe('your_pr');
    expect(tileOpenedProps(view([summary()], { kind: 'none' })).for_whom).toBe('none');
  });

  it('has_glance is false and verdict is null before a glance exists', () => {
    const props = tileOpenedProps(view([summary({ forYou: null, verdict: null })]));
    expect(props.has_glance).toBe(false);
    expect(props.verdict).toBeNull();
  });
});
