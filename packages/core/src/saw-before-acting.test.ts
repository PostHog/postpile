// Read before acting (DESIGN.md "You already dealt with it" › Read before
// acting, 2026-09-30): acting on a PR says the viewer saw what came before
// only when a real read covers it.
import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeCommit, makeEvent, makePr, makeThreadFor, makeTimelineItem, viewer } from './fixtures.ts';
import { eventsSeenByTouch } from './last-touch.ts';
import { touchedReadCheck } from './quiet-reads.ts';
import { actedAfterSeeing, sawBeforeActing } from './saw-before-acting.ts';
import { isPrDone } from './tiles.ts';
import type { Comment, IsoTime, Pr, PrEvent } from './types.ts';

describe('sawBeforeActing', () => {
  const pr = makePr();
  const comment = makeEvent({ id: 'c', actor: 'lyra', at: at(10) });

  it('needs a read at or after the event and at or before the action', () => {
    expect(sawBeforeActing(comment, at(20), { lastReadAt: at(15), handledAt: null }, pr, viewer)).toBe(true);
    expect(sawBeforeActing(comment, at(20), { lastReadAt: null, handledAt: at(15) }, pr, viewer)).toBe(true);
    expect(sawBeforeActing(comment, at(20), { lastReadAt: at(5), handledAt: null }, pr, viewer)).toBe(false);
    expect(sawBeforeActing(comment, at(20), { lastReadAt: at(25), handledAt: null }, pr, viewer)).toBe(false);
    expect(sawBeforeActing(comment, at(20), { lastReadAt: null, handledAt: null }, pr, viewer)).toBe(false);
  });

  it('asks nothing of the viewer own events and of automation', () => {
    const none = { lastReadAt: null, handledAt: null };
    expect(sawBeforeActing(makeEvent({ actor: viewer.login, at: at(10) }), at(20), none, pr, viewer)).toBe(true);
    expect(sawBeforeActing(makeEvent({ kind: 'bot_comment', actor: 'trunk-io[bot]', isBot: true, at: at(10) }), at(20), none, pr, viewer)).toBe(true);
  });
});

describe('actedAfterSeeing', () => {
  const own = makePr({ author: viewer.login, commits: [makeCommit({ oid: 'c1', author: viewer.login, committer: viewer.login, committedAt: at(30) })] });
  const lyra = makeEvent({ id: 'lyra', actor: 'lyra', at: at(10) });
  const push = makeEvent({ id: 'push', kind: 'commits_pushed', actor: viewer.login, sourceId: 'c1', at: at(30) });

  it('counts the viewer newest own activity after everyone else, with a read covering what came before', () => {
    expect(actedAfterSeeing(own, [lyra, push], viewer, { lastReadAt: at(20), handledAt: null })).toBe(true);
    expect(actedAfterSeeing(own, [lyra, push], viewer, { lastReadAt: at(5), handledAt: null })).toBe(false);
  });

  it('needs the activity after the newest person event, and some activity at all', () => {
    const late = makeEvent({ id: 'late', actor: 'lyra', at: at(40) });
    expect(actedAfterSeeing(own, [lyra, push, late], viewer, { lastReadAt: at(35), handledAt: null })).toBe(false);
    expect(actedAfterSeeing(own, [lyra], viewer, { lastReadAt: at(20), handledAt: null })).toBe(false);
  });
});

// Real shapes of 2026-09-30 (names and repo invented), on the viewer's own PR.
describe('scenario: marking a PR ready right after a comment', () => {
  const time = (seconds: number): IsoTime => new Date(Date.UTC(2026, 8, 30, 12, 35, seconds)).toISOString();
  const noon = new Date(Date.UTC(2026, 8, 30, 12, 0)).toISOString();

  function ownPr(comments: Comment[], extra: Partial<Pr> = {}): Pr {
    return makePr({
      number: 94,
      author: viewer.login,
      reviewerUsers: ['rowan'],
      commits: [makeCommit({ oid: 'c1', author: viewer.login, committer: viewer.login, committedAt: noon })],
      timeline: [
        makeTimelineItem({ id: 'rq', actor: viewer.login, subject: 'rowan', at: noon }),
        makeTimelineItem({ id: 'ready', kind: 'ready_for_review', actor: viewer.login, subject: null, at: time(31) }),
      ],
      comments,
      updatedAt: time(31),
      ...extra,
    });
  }

  /** The sync: everything up to GitHub's read time seen, then everything up to the viewer's touch. */
  function synced(pr: Pr, lastReadAt: IsoTime | null): PrEvent[] {
    let events = deriveEvents(pr, viewer, null).map((event) => (lastReadAt !== null && event.at <= lastReadAt ? { ...event, seenAt: lastReadAt } : event));
    const byTouch = eventsSeenByTouch(pr, events, viewer);
    events = events.map((event) => (byTouch.ids.includes(event.id) ? { ...event, seenAt: byTouch.touch!.at } : event));
    return events;
  }

  function touched(pr: Pr, events: PrEvent[], lastReadAt: IsoTime | null, now = time(59)) {
    const thread = makeThreadFor(pr, { lastReadAt, updatedAt: pr.updatedAt, unread: true, reason: 'author' });
    return touchedReadCheck({ thread, pr, events, userState: null, viewer, prFetchedAt: pr.updatedAt, now: new Date(new Date(now).getTime() + 15 * 60_000).toISOString() });
  }

  it('(a) lyra comments at 12:35:25, the viewer marks ready at 12:35:31 without a read: not done, not cleared', () => {
    const lyra = makeComment({ id: 'lyra', author: 'lyra', body: 'one more thing: the flag name', createdAt: time(25) });
    const readyOnly = ownPr([lyra]);
    const events = synced(readyOnly, noon);
    expect(isPrDone(readyOnly, null, viewer, events, false, noon)).toBe(false);
    expect(touched(readyOnly, events, noon)).toEqual({ kind: 'skip', why: 'no_touch' });
    // With a CLI comment at the same second the touch turns lyra's comment seen, but no read covers it.
    const cliComment = makeComment({ id: 'mine', author: viewer.login, body: 'ready for review', createdAt: time(31) });
    const withComment = ownPr([lyra, cliComment]);
    const seenByTouch = synced(withComment, noon);
    expect(seenByTouch.find((event) => event.sourceId === 'lyra')?.seenAt).toBe(time(31));
    expect(isPrDone(withComment, null, viewer, seenByTouch, false, noon)).toBe(false);
    expect(touched(withComment, seenByTouch, noon)).toEqual({ kind: 'skip', why: 'acted_without_seeing' });
  });

  it('(b) GitHub read at 12:35:19, the viewer marks ready at 12:35:31, nobody else after the read: done, and the acted-after read may clear', () => {
    const lastReadAt = time(19);
    const lyra = makeComment({ id: 'lyra', author: 'lyra', body: 'nice, ship it once CI is green', createdAt: time(5) });
    const readied = ownPr([lyra]);
    expect(isPrDone(readied, null, viewer, synced(readied, lastReadAt), false, lastReadAt)).toBe(true);
    // Before this rule it needed a Mark read in PostPile; without the read it still does.
    expect(isPrDone(readied, null, viewer, synced(readied, time(1)), false, time(1))).toBe(false);
    // The same with a comment as the touch and CI after it: the acted-after read clears the thread.
    const cliComment = makeComment({ id: 'mine', author: viewer.login, body: 'ready for review', createdAt: time(31) });
    const withCi = ownPr([lyra, cliComment], {
      checks: { rollup: 'SUCCESS', contexts: [{ name: 'ci', conclusion: 'SUCCESS', completedAt: time(50) }] },
      updatedAt: time(50),
    });
    expect(touched(withCi, synced(withCi, lastReadAt), lastReadAt)).toEqual({ kind: 'mark', reason: 'replied' });
  });
});
