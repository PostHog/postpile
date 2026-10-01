import { describe, expect, it } from 'vitest';
import type { TileGroup } from './tile-groups.ts';
import {
  compareTopicUrgency,
  topicMove,
  topicUrgency,
  topicYourMoves,
  yourMovesByGroup,
  type RankedTopic,
  type TopicMove,
  type UrgencyTile,
  type UrgencyView,
} from './topic-urgency.ts';

/** An unread tile is unread on GitHub with loud news and one unread PR unless the overrides say otherwise. */
function tile(overrides: Partial<UrgencyTile>): UrgencyTile {
  const unread = overrides.state === 'unread';
  return { state: 'open', unreadOnGitHub: unread, unreadPrKeys: unread ? ['acme/app#1'] : [], loud: unread, prStates: ['OPEN'], move: null, quiet: false, ...overrides };
}

const review: TopicMove = { move: 'review', text: 'Review, rowan asked' };
const merge: TopicMove = { move: 'merge', text: 'Merge, it is approved' };

describe('topicUrgency', () => {
  it('needs you while an unread tile is still open', () => {
    const urgency = topicUrgency([tile({ state: 'unread' }), tile({ state: 'unread', prStates: ['MERGED'], unreadPrKeys: ['acme/app#2'] })]);
    expect(urgency).toMatchObject({ unreadTiles: 2, unreadPrs: 2, urgentUnreadTiles: 1, yourMoves: [], needsYou: true });
  });

  it('stays calm when every unread tile is merged or closed', () => {
    const urgency = topicUrgency([tile({ state: 'unread', prStates: ['MERGED'] }), tile({ state: 'unread', prStates: ['CLOSED', 'MERGED'] })]);
    expect(urgency.unreadTiles).toBe(2);
    expect(urgency.urgentUnreadTiles).toBe(0);
    expect(urgency.needsYou).toBe(false);
  });

  it('counts a tile unread with only quiet news, and a snoozed one with an unread thread, but neither lights the topic up', () => {
    const urgency = topicUrgency([tile({ state: 'unread', loud: false }), tile({ state: 'snoozed', unreadOnGitHub: true, unreadPrKeys: ['acme/app#2'], loud: true })]);
    expect(urgency).toMatchObject({ unreadTiles: 2, unreadPrs: 2, urgentUnreadTiles: 0, yourMoves: [], needsYou: false });
  });

  it('counts a PR once when two tiles of the topic share it', () => {
    const urgency = topicUrgency([tile({ state: 'unread', unreadPrKeys: ['acme/app#1', 'acme/app#2'] }), tile({ state: 'unread', unreadPrKeys: ['acme/app#2'] })]);
    expect(urgency.unreadPrs).toBe(2);
    expect(urgency.unreadPrKeys).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('counts a stack as open while one of its layers is', () => {
    expect(topicUrgency([tile({ state: 'unread', prStates: ['MERGED', 'OPEN'] })]).urgentUnreadTiles).toBe(1);
  });

  it('needs you when it is your move, even with nothing unread', () => {
    expect(topicUrgency([tile({ move: review })]).needsYou).toBe(true);
    expect(topicUrgency([tile({ state: 'unread', prStates: ['MERGED'] }), tile({ move: review })]).needsYou).toBe(true);
  });

  it('does not lift a topic for merging your own approved PR, but still counts the move', () => {
    expect(topicUrgency([tile({ move: merge })])).toEqual({
      unreadTiles: 0,
      unreadPrs: 0,
      unreadPrKeys: [],
      urgentUnreadTiles: 0,
      yourMoves: [merge],
      needsYou: false,
    });
    expect(topicUrgency([tile({ move: merge }), tile({ move: review })]).needsYou).toBe(true);
    expect(topicUrgency([tile({ state: 'unread', move: merge })]).needsYou).toBe(true);
  });

  it('ignores your move on done and snoozed tiles', () => {
    expect(topicUrgency([tile({ state: 'done', move: review })])).toMatchObject({ yourMoves: [], needsYou: false });
    expect(topicUrgency([tile({ state: 'snoozed', move: review })])).toMatchObject({ yourMoves: [], needsYou: false });
  });
});

describe('topicUrgency: your moves', () => {
  it('lists the moves on live tiles, most urgent first, tile order on a tie', () => {
    const reply: TopicMove = { move: 'reply', text: "Answer lyra's question" };
    const fix: TopicMove = { move: 'address_changes', text: "Address ada's changes" };
    const other: TopicMove = { move: 'review', text: 'Review for team-platform' };
    const tiles = [tile({ move: merge }), tile({ move: review }), tile({ move: fix }), tile({ move: reply }), tile({ move: other }), tile({ state: 'snoozed', move: reply })];
    expect(topicUrgency(tiles).yourMoves).toEqual([reply, review, other, fix, merge]);
  });

  it('takes the move from a turn that is yours only', () => {
    expect(topicMove({ kind: 'you', move: 're_review', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1' })).toEqual({
      move: 're_review',
      text: 'pim addressed your changes: re-review',
    });
    expect(topicMove({ kind: 'them', who: 'pim', what: 'to merge', prKey: 'acme/app#1' })).toBeNull();
  });
});

/** A built tile as far as the detail's your-move fields care; `move` null means it is somebody else's turn. */
function view(group: TileGroup, state: UrgencyView['state']['kind'], move: TopicMove | null): UrgencyView & { group: TileGroup } {
  const turn: UrgencyView['turn'] = move
    ? { kind: 'you', move: move.move, who: null, what: move.text, prKey: 'acme/app#1' }
    : { kind: 'them', who: 'pim', what: 'to merge', prKey: 'acme/app#1' };
  const tileState = { kind: state, unreadOnGitHub: false, loud: false } as UrgencyView['state'];
  return { group, state: tileState, unreadPrKeys: [], turn, quietRepo: false, prs: [{ state: 'OPEN', quietRepo: false }] };
}

describe('topic detail: your moves', () => {
  const tiles = [
    view('open', 'open', review),
    view('open', 'open', null),
    view('open', 'snoozed', review),
    view('unread', 'unread', merge),
    view('dealt_with', 'done', review),
  ];

  it('gives the header the sidebar rule: live tiles only, most urgent first', () => {
    expect(topicYourMoves(tiles)).toEqual([review, merge]);
    expect(topicYourMoves(tiles)).toEqual(topicUrgency(tiles.map((tile) => ({ ...tile, state: tile.state.kind, unreadOnGitHub: false, loud: false, prStates: ['OPEN'], move: topicMove(tile.turn), quiet: false }))).yourMoves);
  });

  it('counts the live moves per group, snoozed and done tiles left out', () => {
    expect(yourMovesByGroup(tiles)).toEqual({ unread: 1, open: 1, dealt_with: 0 });
  });

  it('has every group at 0 when no tile waits on you', () => {
    expect(yourMovesByGroup([view('open', 'open', null)])).toEqual({ unread: 0, open: 0, dealt_with: 0 });
    expect(topicYourMoves([])).toEqual([]);
  });
});

describe('compareTopicUrgency', () => {
  const rank = (overrides: Partial<RankedTopic>): RankedTopic => ({ group: 'quiet', urgentUnreadTiles: 0, unreadTiles: 0, ...overrides });

  it('ranks needs-you first, then open unread, then merged-since-you-looked', () => {
    const calm = rank({ unreadTiles: 5 });
    const urgent = rank({ group: 'needs_you', urgentUnreadTiles: 1, unreadTiles: 1 });
    const moreUrgent = rank({ group: 'needs_you', urgentUnreadTiles: 2, unreadTiles: 2 });
    const quiet = rank({});
    expect([quiet, calm, urgent, moreUrgent].sort(compareTopicUrgency)).toEqual([moreUrgent, urgent, calm, quiet]);
  });

  it('is a tie for equal topics', () => {
    expect(compareTopicUrgency(rank({ unreadTiles: 1 }), rank({ unreadTiles: 1 }))).toBe(0);
  });
});

describe('quiet repos', () => {
  it('never makes a topic urgent from a quiet tile', () => {
    const urgency = topicUrgency([tile({ state: 'unread', quiet: true }), tile({ move: review, quiet: true })]);
    expect(urgency).toMatchObject({ unreadTiles: 1, unreadPrs: 1, urgentUnreadTiles: 0, yourMoves: [review], needsYou: false });
  });

  it('lets a mixed tile count only its PRs outside quiet repos', () => {
    // The engine passes the states of the non-quiet PRs: here only a merged one.
    expect(topicUrgency([tile({ state: 'unread', prStates: ['MERGED'] })]).needsYou).toBe(false);
  });
});
