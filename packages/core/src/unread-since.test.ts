import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr } from './fixtures.ts';
import { unreadRows, unreadSinceLooked, type UnreadEvent } from './unread-since.ts';

describe('unreadSinceLooked', () => {
  const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice', body: 'One.\n\nTwo.' }), makeComment({ id: 'c2', author: 'bob', body: 'seen already' })] });

  it('lists the unseen events oldest first, a person comment with its whole body, bots and pushes as one line', () => {
    const events = [
      makeEvent({ id: 'e3', kind: 'commits_pushed', actor: 'alice', sourceId: 'p1', summary: 'alice pushed 2 commits', at: at(3), seenAt: null }),
      makeEvent({ id: 'e1', kind: 'comment', actor: 'alice', sourceId: 'c1', summary: 'alice commented: One.', at: at(1), seenAt: null }),
      makeEvent({ id: 'e2', kind: 'comment', actor: 'bob', sourceId: 'c2', summary: 'bob commented', at: at(2), seenAt: at(5) }),
      makeEvent({ id: 'e4', kind: 'bot_comment', actor: 'greptile-apps[bot]', isBot: true, sourceId: 'b1', summary: 'greptile commented', at: at(4), seenAt: null }),
    ];

    expect(unreadSinceLooked(events, pr).map((event) => [event.id, event.body])).toEqual([
      ['e1', 'One.\n\nTwo.'],
      ['e3', null],
      ['e4', null],
    ]);
  });
});

describe('unreadRows', () => {
  let n = 0;
  function event(overrides: Partial<UnreadEvent>): UnreadEvent {
    n += 1;
    return { id: `e${n}`, kind: 'comment', actor: 'alice', isBot: false, personTalk: false, at: at(n), summary: 'x', body: null, ...overrides };
  }

  it("keeps people's talk one row each, folds a bot per actor and kind, pushes per pusher", () => {
    const talk = event({ personTalk: true, summary: 'alice commented', body: 'whole text' });
    const checks = Array.from({ length: 180 }, () => event({ kind: 'deploy', actor: 'github-actions[bot]', isBot: true }));
    const botNote = event({ kind: 'bot_comment', actor: 'github-actions[bot]', isBot: true });
    const pushes = [event({ kind: 'commits_pushed', actor: 'bob' }), event({ kind: 'force_pushed', actor: 'bob' })];

    const rows = unreadRows([talk, ...checks, botNote, ...pushes]);

    expect(rows.map((row) => (row.kind === 'event' ? row.event.summary : `${row.actor}: ${row.count} ${row.what}`))).toEqual([
      'alice commented',
      'github-actions[bot]: 180 deploy events',
      'github-actions[bot]: 1 bot comment event',
      'bob: 2 pushes',
    ]);
    const folded = rows.find((row) => row.kind === 'folded');
    expect(folded).toMatchObject({ from: checks[0]?.at, to: checks.at(-1)?.at });
    // Every event sits in exactly one row.
    const ids = rows.flatMap((row) => (row.kind === 'event' ? [row.event.id] : row.ids));
    expect(ids.toSorted()).toEqual([talk, ...checks, botNote, ...pushes].map((item) => item.id).toSorted());
  });

  it('folds other events without text only when one actor repeats one kind more than 3 times', () => {
    const three = Array.from({ length: 3 }, () => event({ kind: 'review_requested', actor: 'carol' }));
    const four = Array.from({ length: 4 }, () => event({ kind: 'review_request_removed', actor: 'dave' }));

    const rows = unreadRows([...three, ...four]);

    expect(rows.filter((row) => row.kind === 'event')).toHaveLength(3);
    expect(rows.filter((row) => row.kind === 'folded')).toMatchObject([{ actor: 'dave', count: 4 }]);
  });
});
