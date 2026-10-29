import { describe, expect, it } from 'vitest';
import { makeEvent, makePr, makeReview, makeTimelineItem, singleTile, viewer } from './fixtures.ts';
import type { PrEvent } from './types.ts';
import { topicMove } from './topic-urgency.ts';
import { tileWaitDays, topicWaitDays, WAIT_MARKER_MIN_DAYS, waitMarkerDays, workingDaysBetween } from './waiting-days.ts';
import { whoseTurn, type WhoseTurn } from './whose-turn.ts';

// 2026-10-26 is a Monday.
const monday = '2026-10-26T09:00:00.000Z';
const at = (date: string, time = '12:00:00') => new Date(`${date}T${time}.000Z`);

describe('workingDaysBetween', () => {
  it('counts weekdays after the day of since, up to and including today', () => {
    expect(workingDaysBetween(monday, at('2026-10-26', '23:59:59'))).toBe(0);
    expect(workingDaysBetween(monday, at('2026-10-27'))).toBe(1);
    expect(workingDaysBetween(monday, at('2026-10-29'))).toBe(3);
    expect(workingDaysBetween(monday, at('2026-11-02'))).toBe(5);
  });

  it('skips the weekend', () => {
    const friday = '2026-10-23T16:00:00.000Z';
    expect(workingDaysBetween(friday, at('2026-10-24'))).toBe(0);
    expect(workingDaysBetween(friday, at('2026-10-25'))).toBe(0);
    expect(workingDaysBetween(friday, at('2026-10-26'))).toBe(1);
    expect(workingDaysBetween('2026-10-24T10:00:00.000Z', at('2026-10-26'))).toBe(1);
  });

  it('goes by UTC dates, not 24-hour spans', () => {
    expect(workingDaysBetween('2026-10-26T23:30:00.000Z', at('2026-10-27', '00:30:00'))).toBe(1);
    expect(workingDaysBetween('2026-10-26T00:30:00.000Z', at('2026-10-26', '23:30:00'))).toBe(0);
  });

  it('is 0 for a future or unreadable since', () => {
    expect(workingDaysBetween('2026-11-02T09:00:00.000Z', at('2026-10-26'))).toBe(0);
    expect(workingDaysBetween('not a date', at('2026-10-26'))).toBe(0);
  });
});

describe('waitMarkerDays', () => {
  it(`shows from ${WAIT_MARKER_MIN_DAYS} working days`, () => {
    expect(waitMarkerDays(monday, at('2026-10-28'))).toBeNull();
    expect(waitMarkerDays(monday, at('2026-10-29'))).toBe(3);
    expect(waitMarkerDays(monday, at('2026-11-03'))).toBe(6);
  });

  it('is null without a since', () => {
    expect(waitMarkerDays(undefined, at('2026-11-03'))).toBeNull();
    expect(waitMarkerDays(null, at('2026-11-03'))).toBeNull();
  });
});

describe('tileWaitDays', () => {
  const later = at('2026-11-03');
  const review: WhoseTurn = { kind: 'you', move: 'review', who: null, what: 'Review, rowan asked', prKey: 'acme/app#1', since: monday };

  it('shows on your move on an open or unread tile', () => {
    expect(tileWaitDays(review, 'open', later)).toBe(6);
    expect(tileWaitDays(review, 'unread', later)).toBe(6);
  });

  it('never shows on a snoozed or done tile', () => {
    expect(tileWaitDays(review, 'snoozed', later)).toBeNull();
    expect(tileWaitDays(review, 'done', later)).toBeNull();
  });

  it('never shows on a merge move or someone else’s move', () => {
    expect(tileWaitDays({ ...review, move: 'merge', what: 'Merge, it is approved' }, 'open', later)).toBeNull();
    expect(tileWaitDays({ kind: 'them', who: 'rowan', what: 'to merge', prKey: 'acme/app#1' }, 'open', later)).toBeNull();
  });
});

describe('topicWaitDays', () => {
  const later = at('2026-11-03');

  it('takes the oldest wait among the moves, merge moves left out', () => {
    const moves = [
      { move: 'reply' as const, text: 'alice mentioned you', since: '2026-10-29T09:00:00.000Z' },
      { move: 'review' as const, text: 'Review', since: monday },
      { move: 'merge' as const, text: 'Merge, it is approved', since: '2026-10-01T09:00:00.000Z' },
    ];
    expect(topicWaitDays(moves, later)).toBe(6);
  });

  it('is null when no move has waited long enough or none has a since', () => {
    expect(topicWaitDays([{ move: 'review', text: 'Review', since: '2026-11-02T09:00:00.000Z' }], later)).toBeNull();
    expect(topicWaitDays([{ move: 'review', text: 'Review' }], later)).toBeNull();
    expect(topicWaitDays([], later)).toBeNull();
  });
});

describe('whose turn carries since', () => {
  const me = viewer.login;

  function turnOf(pr: ReturnType<typeof makePr>, events: PrEvent[] = []): WhoseTurn {
    return whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map([[pr.key, events]]), userStates: new Map(), viewer });
  }

  it('reply: the unanswered ask', () => {
    const mention = makeEvent({ kind: 'mention', ruleLoudness: 'loud', actor: 'alice', at: monday });
    expect(turnOf(makePr({ author: 'alice' }), [mention])).toMatchObject({ kind: 'you', move: 'reply', since: monday });
  });

  it('review: the request of you', () => {
    const request = makeTimelineItem({ actor: 'alice', subject: me, at: monday });
    const turn = turnOf(makePr({ author: 'alice', reviewerUsers: [me], timeline: [request] }));
    expect(turn).toMatchObject({ kind: 'you', move: 'review', since: monday });
    expect(topicMove(turn)).toEqual({ move: 'review', text: 'Review, alice asked', since: monday });
  });

  it('address_changes: the change request on your own PR', () => {
    const changes = makeReview({ id: 'r1', author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: monday });
    expect(turnOf(makePr({ author: me, reviews: [changes] }))).toMatchObject({ kind: 'you', move: 'address_changes', since: monday });
  });

  it('merge and drafts carry none', () => {
    const approved = makePr({ author: me, reviewDecision: 'APPROVED' });
    expect(turnOf(approved)).toMatchObject({ kind: 'you', move: 'merge' });
    expect(turnOf(approved)).not.toHaveProperty('since');
    const changes = makeReview({ id: 'r1', author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: monday });
    const draft = turnOf(makePr({ author: me, isDraft: true, reviews: [changes] }));
    expect(draft).toMatchObject({ kind: 'you', move: 'address_changes' });
    expect(draft).not.toHaveProperty('since');
  });
});
