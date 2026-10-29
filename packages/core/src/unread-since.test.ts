import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr } from './fixtures.ts';
import { unreadSinceLooked } from './unread-since.ts';

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
