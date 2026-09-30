import { describe, expect, it } from 'vitest';
import type { PrSummary, TileView, TopicDetail, WhoseTurn } from '@postpile/core';
import { at, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import { markedReadPr, markedReadTile, snoozedTile, withTile } from './optimistic.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REVIEW: WhoseTurn = { kind: 'you', move: 'review', who: 'rowan', what: 'Review, rowan asked', prKey: 'acme/app#1' };

function summary(number: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: `acme/app#${number}`,
    title: `PR ${number}`,
    url: '',
    author: 'rowan',
    assignees: [],
    state: 'OPEN',
    primaryAction: 'mark_read',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'mention' },
    why: '@',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    authorRelation: 'team',
    status: { lifecycle: 'open', review: 'review', agentApprovers: [] },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 2,
    unreadOnGitHub: false,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: REVIEW,
    facts: NO_PR_FACTS,
    afterRead: { done: true, turn: NONE },
    whatsNew: null,
    updatedAt: at(number),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function unreadTile(prs: PrSummary[]): TileView {
  return withOffers({
    tile: { id: 'set:s1', topicId: 't1', kind: 'set', title: 'Cache PRs', members: [], stacks: [] },
    state: { kind: 'unread', unreadBecause: [{ prKey: 'acme/app#1', eventId: 'e1', kind: 'mention', actor: 'lyra', summary: 'x', at: at(1) }], unreadOnGitHub: true, loud: true },
    prs,
    why: '@',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    people: [],
    turn: REVIEW,
    afterRead: { done: true, turn: NONE },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  });
}

describe('markedReadTile', () => {
  it('takes state and turn from afterRead and marks every row, a pulled-in layer only seen', () => {
    const layer = summary(2, { provenance: { kind: 'pulled_in', reason: 'stack' }, afterRead: { done: false, turn: NONE } });
    const marked = markedReadTile(unreadTile([summary(1), layer]));

    expect(marked.state).toEqual({ kind: 'done', unreadBecause: [], unreadOnGitHub: false, loud: false });
    expect(marked.turn).toEqual(NONE);
    expect(marked.prs.map((pr) => [pr.unseenLoudEvents, pr.done])).toEqual([
      [0, true],
      [0, false],
    ]);
  });

  it('leaves a tile that stays your move open, and a snoozed tile snoozed', () => {
    const stillYours = { ...unreadTile([summary(1)]), afterRead: { done: false, turn: REVIEW } };
    expect(markedReadTile(stillYours).state.kind).toBe('open');
    expect(markedReadTile(snoozedTile(stillYours)).state.kind).toBe('snoozed');
  });
});

describe('markedReadPr', () => {
  it('changes only that row and leaves the tile state to the server', () => {
    const view = unreadTile([summary(1), summary(3)]);
    const marked = markedReadPr(view, 'acme/app#3');

    expect(marked.state).toBe(view.state);
    expect(marked.prs[0]).toBe(view.prs[0]);
    expect(marked.prs[1]).toMatchObject({ unseenLoudEvents: 0, done: true, turn: NONE });
  });
});

describe('withTile', () => {
  it('returns a topic without the tile unchanged, so the other cached topics keep their identity', () => {
    const detail = { tiles: [unreadTile([summary(1)])] } as unknown as TopicDetail;
    expect(withTile(detail, 'set:other', snoozedTile)).toBe(detail);
    expect(withTile(detail, 'set:s1', snoozedTile).tiles[0]?.state.kind).toBe('snoozed');
  });
});
