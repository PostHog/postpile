import { describe, expect, it } from 'vitest';
import { inboxTotals, isUnreadNothingToDo, prMarks, prMarksText, rowClears, type CoverageView } from './inbox-coverage.ts';
import type { TopicMove } from './topic-urgency.ts';
import type { WhoseTurn } from './whose-turn.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const TEAM_REVIEW: WhoseTurn = { kind: 'you', move: 'review', what: 'Review for team-platform', who: null, prKey: 'acme/app#4' };
const review: TopicMove = { move: 'review', text: 'Review, rowan asked' };

function view(overrides: Partial<CoverageView>): CoverageView {
  return { group: 'unread', turn: NONE, unreadPrKeys: ['acme/app#1'], prs: [{ key: 'acme/app#1', state: 'MERGED', tier: 'rest' }], ...overrides };
}

describe('inboxTotals', () => {
  it('adds up unread tiles and your moves, and counts a PR in two topics once', () => {
    const totals = inboxTotals([
      { unreadTiles: 2, unreadPrKeys: ['acme/app#1', 'acme/app#2'], yourMoves: [review] },
      { unreadTiles: 1, unreadPrKeys: ['acme/app#2'], yourMoves: [review, review] },
    ]);
    expect(totals).toEqual({ unreadTiles: 3, unreadPrs: 2, yourMoveTiles: 3 });
  });
});

describe('isUnreadNothingToDo', () => {
  it('holds for an unread tile of merged and closed PRs that asks nothing', () => {
    const prs: CoverageView['prs'] = [
      { key: 'acme/app#1', state: 'MERGED', tier: 'rest' },
      { key: 'acme/app#2', state: 'CLOSED', tier: 'rest' },
    ];
    expect(isUnreadNothingToDo(view({ prs }))).toBe(true);
  });

  it('fails with an open PR, an ask after the merge, a move, or a tile that is not unread', () => {
    expect(isUnreadNothingToDo(view({ prs: [{ key: 'acme/app#1', state: 'OPEN', tier: 'rest' }] }))).toBe(false);
    expect(isUnreadNothingToDo(view({ prs: [{ key: 'acme/app#1', state: 'MERGED', tier: 'needs_reply' }] }))).toBe(false);
    expect(isUnreadNothingToDo(view({ turn: { kind: 'you', move: 'reply', what: 'Reply to bob', who: null, prKey: 'acme/app#1' } }))).toBe(false);
    expect(isUnreadNothingToDo(view({ group: 'open' }))).toBe(false);
  });
});

describe('rowClears', () => {
  it('says marking read never clears a move', () => {
    expect(rowClears({ turn: TEAM_REVIEW, prs: [] })).toBe('review, or remove the request on GitHub; mark_read does not');
    expect(rowClears({ turn: { ...TEAM_REVIEW, move: 'reply' }, prs: [] })).toBe('reply on GitHub; mark_read does not');
  });

  it('clears a team mention on read, the one ask that does', () => {
    const teamMention: WhoseTurn = { kind: 'you', move: 'reply', what: 'ines mentioned your team', who: null, prKey: 'acme/app#2', teamAsk: true };
    expect(rowClears({ turn: teamMention, prs: [{ key: 'acme/app#2', turn: teamMention }] })).toBe('mark_read with the seen_through from pr_context (a team mention asks only until read)');
  });

  it('keeps a team mention on GitHub when another PR of the tile has a move of its own', () => {
    const teamMention: WhoseTurn = { kind: 'you', move: 'reply', what: 'ines mentioned your team', who: null, prKey: 'acme/app#2', teamAsk: true };
    const prs = [
      { key: 'acme/app#2', turn: teamMention },
      { key: 'acme/app#4', turn: TEAM_REVIEW },
    ];
    expect(rowClears({ turn: teamMention, prs })).toBe('reply on GitHub; mark_read does not');
  });

  it('clears on read when every move in the tile is a team mention', () => {
    const first: WhoseTurn = { kind: 'you', move: 'reply', what: 'ines mentioned your team', who: null, prKey: 'acme/app#2', teamAsk: true };
    const second: WhoseTurn = { ...first, prKey: 'acme/app#3' };
    const prs = [
      { key: 'acme/app#2', turn: first },
      { key: 'acme/app#3', turn: second },
    ];
    expect(rowClears({ turn: first, prs })).toBe('mark_read with the seen_through from pr_context (a team mention asks only until read)');
  });

  it('sends a tile without a move to mark_read through pr_context', () => {
    expect(rowClears({ turn: NONE, prs: [] })).toBe('mark_read with the seen_through from pr_context');
  });
});

describe('prMarks', () => {
  it('marks merged layers as context and the open top layer as owning the move', () => {
    const tile = { turn: TEAM_REVIEW, unreadPrKeys: ['acme/app#3', 'acme/app#4'] };
    expect(prMarksText(prMarks(tile, { key: 'acme/app#1', state: 'MERGED', turn: NONE }))).toBe('context layer (merged)');
    expect(prMarksText(prMarks(tile, { key: 'acme/app#3', state: 'CLOSED', turn: NONE }))).toBe('context layer (closed), unread');
    expect(prMarks(tile, { key: 'acme/app#4', state: 'OPEN', turn: TEAM_REVIEW })).toEqual({ unread: true, ownsMove: 'review', contextLayer: null });
    expect(prMarksText(prMarks(tile, { key: 'acme/app#4', state: 'OPEN', turn: TEAM_REVIEW }))).toBe('unread, owns the move: review');
  });

  it('never calls a merged PR with an ask after the merge a context layer', () => {
    const askAfterMerge: WhoseTurn = { kind: 'you', move: 'reply', what: "Answer jude's question", who: null, prKey: 'acme/app#1' };
    const marks = prMarks({ turn: askAfterMerge, unreadPrKeys: ['acme/app#1'] }, { key: 'acme/app#1', state: 'MERGED', turn: askAfterMerge });
    expect(marks).toEqual({ unread: true, ownsMove: 'reply', contextLayer: null });
  });

  it('marks nothing on an open, read PR without the move', () => {
    expect(prMarksText(prMarks({ turn: NONE, unreadPrKeys: [] }, { key: 'acme/app#5', state: 'OPEN', turn: NONE }))).toBe('');
  });
});
