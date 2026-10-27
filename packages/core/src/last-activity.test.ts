// The order tie-break (2026-10-27): newest activity by someone else first.
// The viewer's own reads, approvals and replies must never move a topic or
// a tile up, so each order test adds such an event and checks nothing moves.
import { describe, expect, it } from 'vitest';
import { at, makeEvent, viewer } from './fixtures.ts';
import { compareByActivity, isOthersActivity, newestActivity, othersActivityAt } from './last-activity.ts';
import { compareTileViews } from './tile-view.ts';
import { compareTopics, UNSORTED_TOPIC_ID, type ListedTopic } from './topic-sections.ts';
import type { PrEvent, TileState } from './types.ts';
import { NO_TURN, type WhoseTurn } from './whose-turn.ts';

const othersComment = makeEvent({ actor: 'alice', at: at(10) });
const viewerApproval = makeEvent({ id: 'acme/app#1:review_approved:r1', kind: 'review_approved', actor: 'viewer', at: at(50), sourceId: 'r1' });
const viewerReply = makeEvent({ id: 'acme/app#1:comment:c9', actor: 'viewer', at: at(60), sourceId: 'c9' });

describe('isOthersActivity', () => {
  const table: [string, PrEvent, boolean][] = [
    ["someone else's comment counts", othersComment, true],
    ['a review request on the viewer counts', makeEvent({ kind: 'review_requested', actor: 'alice', ruleLoudness: 'loud' }), true],
    ['a merge by the merge queue bot counts (a state change)', makeEvent({ kind: 'merged', actor: 'trunk-io[bot]', isBot: true }), true],
    ["the viewer's approval never counts", viewerApproval, false],
    ["the viewer's reply never counts", viewerReply, false],
    ['a push only rides along', makeEvent({ kind: 'commits_pushed', actor: 'alice' }), false],
    ['a push that answers your changes request is loud and counts', makeEvent({ kind: 'commits_pushed', actor: 'alice', ruleLoudness: 'loud' }), true],
    ["a bot's comment only rides along", makeEvent({ kind: 'bot_comment', actor: 'ci-bot[bot]', isBot: true }), false],
    ['a muted event is noise', makeEvent({ actor: 'alice', ruleLoudness: 'muted' }), false],
    ['bot talk is noise', makeEvent({ actor: 'alice', chatter: true }), false],
    ["the app's own Look closer is not GitHub activity", makeEvent({ kind: 'look_closer', actor: '', ruleLoudness: 'loud' }), false],
  ];

  it.each(table)('%s', (_name, event, expected) => {
    expect(isOthersActivity(event, viewer)).toBe(expected);
  });
});

describe('othersActivityAt', () => {
  it("is the newest of other people's activity", () => {
    const later = makeEvent({ id: 'acme/app#1:comment:c2', actor: 'bob', at: at(30), sourceId: 'c2' });
    expect(othersActivityAt([othersComment, later], viewer)).toBe(at(30));
  });

  it("ignores the viewer's own later approval and reply", () => {
    expect(othersActivityAt([othersComment, viewerApproval, viewerReply], viewer)).toBe(at(10));
  });

  it('is null with nothing but the viewer and noise', () => {
    expect(othersActivityAt([viewerReply, makeEvent({ kind: 'commits_pushed', actor: 'alice' })], viewer)).toBeNull();
  });

  it('does not depend on whether the viewer has seen the events', () => {
    expect(othersActivityAt([{ ...othersComment, seenAt: at(20) }], viewer)).toBe(at(10));
  });
});

describe('newestActivity and compareByActivity', () => {
  it('picks the newest time and skips nulls', () => {
    expect(newestActivity([null, at(5), at(9), null])).toBe(at(9));
    expect(newestActivity([null])).toBeNull();
  });

  it('sorts newest first and no activity last', () => {
    expect([null, at(1), at(9), at(5)].sort(compareByActivity)).toEqual([at(9), at(5), at(1), null]);
  });
});

describe('compareTopics', () => {
  function topic(name: string, events: PrEvent[], id = name): ListedTopic {
    return {
      topic: { id, name },
      group: 'quiet',
      urgentUnreadTiles: 0,
      unreadTiles: 0,
      queues: { byYou: 0 },
      yourMoves: [],
      othersActivityAt: othersActivityAt(events, viewer),
    };
  }
  const names = (topics: ListedTopic[]) => topics.sort(compareTopics).map((entry) => entry.topic.name);

  it('breaks a tie in the section by the newest activity, then by name', () => {
    const older = topic('Alpha', [othersComment]);
    const newer = topic('Beta', [makeEvent({ actor: 'bob', at: at(40) })]);
    const none = topic('Aardvark', []);
    expect(names([older, none, newer])).toEqual(['Beta', 'Alpha', 'Aardvark']);
  });

  it("keeps the order when the viewer acts on the lower topic", () => {
    const newer = topic('Beta', [makeEvent({ actor: 'bob', at: at(40) })]);
    const touched = topic('Alpha', [othersComment, viewerApproval, viewerReply]);
    expect(names([touched, newer])).toEqual(['Beta', 'Alpha']);
  });

  it('keeps the section rules first', () => {
    const recent = topic('Recent', [makeEvent({ actor: 'bob', at: at(40) })]);
    const unread = { ...topic('Unread', [othersComment]), unreadTiles: 1 };
    expect(names([recent, unread])).toEqual(['Unread', 'Recent']);
  });

  it('puts Unsorted last whatever its activity', () => {
    const unsorted = topic('Unsorted', [makeEvent({ actor: 'bob', at: at(90) })], UNSORTED_TOPIC_ID);
    expect(names([unsorted, topic('Quiet', [])])).toEqual(['Quiet', 'Unsorted']);
  });
});

describe('compareTileViews', () => {
  const open: TileState = { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false };
  const done: TileState = { ...open, kind: 'done' };
  const yourMove: WhoseTurn = { kind: 'you', move: 'review', who: null, what: 'Review', prKey: 'acme/app#1' };
  function tile(name: string, state: TileState, events: PrEvent[], turn: WhoseTurn = NO_TURN) {
    return { name, state, turn, othersActivityAt: othersActivityAt(events, viewer) };
  }
  const names = (tiles: ReturnType<typeof tile>[]) => tiles.sort(compareTileViews).map((entry) => entry.name);

  it('keeps the list rank first, then the newest activity', () => {
    const doneRecent = tile('done recent', done, [makeEvent({ actor: 'bob', at: at(90) })]);
    const openOld = tile('open old', open, [othersComment]);
    const openNew = tile('open new', open, [makeEvent({ actor: 'bob', at: at(40) })]);
    expect(names([doneRecent, openOld, openNew])).toEqual(['open new', 'open old', 'done recent']);
  });

  it("does not move a tile up when the viewer approves or replies on it", () => {
    const newer = tile('newer', open, [makeEvent({ actor: 'bob', at: at(40) })], yourMove);
    const touched = tile('touched', open, [othersComment, viewerApproval, viewerReply], yourMove);
    expect(names([touched, newer])).toEqual(['newer', 'touched']);
  });
});
