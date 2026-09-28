import { describe, expect, it } from 'vitest';
import { compareTopicUrgency, topicUrgency, type RankedTopic, type UrgencyTile } from './topic-urgency.ts';

function tile(overrides: Partial<UrgencyTile>): UrgencyTile {
  return { state: 'open', prStates: ['OPEN'], yourMove: false, ...overrides };
}

describe('topicUrgency', () => {
  it('needs you while an unread tile is still open', () => {
    const urgency = topicUrgency([tile({ state: 'unread' }), tile({ state: 'unread', prStates: ['MERGED'] })]);
    expect(urgency).toEqual({ unreadTiles: 2, urgentUnreadTiles: 1, yourMoveTiles: 0, needsYou: true });
  });

  it('stays calm when every unread tile is merged or closed', () => {
    const urgency = topicUrgency([tile({ state: 'unread', prStates: ['MERGED'] }), tile({ state: 'unread', prStates: ['CLOSED', 'MERGED'] })]);
    expect(urgency.unreadTiles).toBe(2);
    expect(urgency.urgentUnreadTiles).toBe(0);
    expect(urgency.needsYou).toBe(false);
  });

  it('counts a stack as open while one of its layers is', () => {
    expect(topicUrgency([tile({ state: 'unread', prStates: ['MERGED', 'OPEN'] })]).urgentUnreadTiles).toBe(1);
  });

  it('needs you when it is your move, even with nothing unread', () => {
    expect(topicUrgency([tile({ yourMove: true })]).needsYou).toBe(true);
    expect(topicUrgency([tile({ state: 'unread', prStates: ['MERGED'] }), tile({ yourMove: true })]).needsYou).toBe(true);
  });

  it('ignores your move on done tiles', () => {
    expect(topicUrgency([tile({ state: 'done', yourMove: true })])).toMatchObject({ yourMoveTiles: 0, needsYou: false });
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
