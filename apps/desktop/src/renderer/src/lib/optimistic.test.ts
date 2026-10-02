import { describe, expect, it } from 'vitest';
import type { PrSummary, TileView, TopicDetail, WhoseTurn } from '@postpile/core';
import { at, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import { approvedPrsTile, markedReadPr, markedReadTile, snoozedTile, withTile, withTiles } from './optimistic.ts';

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
    glanceRefreshBlock: null,
    glanceState: 'ready',
    unseenLoudEvents: 2,
    unreadOnGitHub: false,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: REVIEW,
    facts: NO_PR_FACTS,
    afterRead: { done: true, turn: NONE },
    openedRead: NO_OPENED_READ,
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
    state: { kind: 'unread', unreadBecause: [{ prKey: 'acme/app#1', eventId: 'e1', kind: 'mention', actor: 'lyra', summary: 'x', at: at(1), automation: false, loud: true, importance: 0 }], unreadOnGitHub: true, loud: true },
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
    const marked = markedReadTile({ ...unreadTile([summary(1), layer]), unreadPrKeys: ['acme/app#1', 'acme/app#2'] });
    expect(marked.unreadPrKeys).toEqual([]);

    expect(marked.state).toEqual({ kind: 'done', unreadBecause: [], unreadOnGitHub: false, loud: false });
    expect([marked.group, marked.newBadge]).toEqual(['dealt_with', false]);
    expect(marked.turn).toEqual(NONE);
    expect(marked.prs.map((pr) => [pr.unseenLoudEvents, pr.done])).toEqual([
      [0, true],
      [0, false],
    ]);
  });

  it('leaves a tile that stays your move open, and a snoozed tile snoozed', () => {
    const stillYours = { ...unreadTile([summary(1)]), afterRead: { done: false, turn: REVIEW } };
    expect(markedReadTile(stillYours).state.kind).toBe('open');
    expect(markedReadTile(stillYours).group).toBe('open');
    expect(markedReadTile(snoozedTile(stillYours)).state.kind).toBe('snoozed');
    // A snoozed tile marked read leaves Unread for Open, even when a mark-read would leave it done.
    expect(markedReadTile(snoozedTile(unreadTile([summary(1)]))).group).toBe('open');
  });
});

describe('snoozedTile', () => {
  it('keeps a tile with an unread thread in Unread and moves one unread only by other news to Open', () => {
    const threadUnread = unreadTile([summary(1)]);
    expect([snoozedTile(threadUnread).group, snoozedTile(threadUnread).newBadge]).toEqual(['unread', false]);
    // Unread only through a pulled-in layer's loud news or a Look closer event: no thread unread on GitHub.
    const newsOnly = withOffers({ ...threadUnread, state: { ...threadUnread.state, unreadOnGitHub: false } });
    expect(newsOnly.group).toBe('unread');
    expect(snoozedTile(newsOnly).group).toBe('open');
  });
});

describe('markedReadPr', () => {
  it('changes only that row and leaves the tile state to the server', () => {
    const view = { ...unreadTile([summary(1), summary(3)]), unreadPrKeys: ['acme/app#1', 'acme/app#3'] };
    const marked = markedReadPr(view, 'acme/app#3');

    expect(marked.unreadPrKeys).toEqual(['acme/app#1']);
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

describe('approvedPrsTile', () => {
  it('sends a tile whose only unread PR was approved to Dealt with and drops its agent Approve', () => {
    const view = { ...unreadTile([summary(1)]), unreadPrKeys: ['acme/app#1'] };
    const approved = approvedPrsTile(view, ['acme/app#1']);

    expect(approved.unreadPrKeys).toEqual([]);
    expect([approved.state.kind, approved.group]).toEqual(['done', 'dealt_with']);
    expect(approved.prs[0]).toMatchObject({ unseenLoudEvents: 0, done: true });
    expect(approved.agent.approve).toBeNull();
  });

  it('keeps the tile unread while another PR is, and ignores a tile without the PR', () => {
    const view = { ...unreadTile([summary(1), summary(3)]), unreadPrKeys: ['acme/app#1', 'acme/app#3'] };
    const approved = approvedPrsTile(view, ['acme/app#3']);

    expect(approved.unreadPrKeys).toEqual(['acme/app#1']);
    expect(approved.state).toBe(view.state);
    expect(approvedPrsTile(view, ['acme/app#9'])).toBe(view);
  });
});

describe('withTiles', () => {
  it('changes every listed tile in one result and leaves the input untouched', () => {
    const second = { ...unreadTile([summary(3)]), tile: { ...unreadTile([]).tile, id: 'set:s2' } };
    const detail = { tiles: [unreadTile([summary(1)]), second] } as unknown as TopicDetail;
    const changed = withTiles(detail, ['set:s1', 'set:s2'], snoozedTile);

    expect(changed.tiles.map((view) => view.state.kind)).toEqual(['snoozed', 'snoozed']);
    expect(detail.tiles.map((view) => view.state.kind)).toEqual(['unread', 'unread']);
  });
});
