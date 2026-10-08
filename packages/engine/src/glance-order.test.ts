import { makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from './board.ts';
import { glanceTargetKeys } from './glance-inputs.ts';
import { saveViewer } from './viewer-meta.ts';

describe('glance order', () => {
  let store: Store;

  beforeEach(() => {
    store = Store.open(':memory:');
    saveViewer(store, viewer);
  });

  afterEach(() => {
    store.close();
  });

  it('puts the PRs where it is the viewer move first, then the most urgent tiles', () => {
    // #1: unread, but nothing asked of the viewer. #2: read, a review asked of the viewer. #3: read, nothing asked.
    const unread = makePr({ number: 1, author: 'alice' });
    const asked = makePr({ number: 2, author: 'alice', reviewerUsers: [viewer.login] });
    const quiet = makePr({ number: 3, author: 'alice' });
    for (const pr of [unread, asked, quiet]) {
      store.prs.upsert(pr, '2026-09-01T09:00:00Z');
    }
    store.notifications.upsertMany([
      makeThreadFor(unread, { reason: 'subscribed' }),
      makeThreadFor(asked, { unread: false, lastReadAt: '2026-09-01T09:30:00Z' }),
      makeThreadFor(quiet, { reason: 'subscribed', unread: false, lastReadAt: '2026-09-01T09:30:00Z' }),
    ]);

    const board = Board.load(store, '2026-09-01T10:00:00Z');
    expect([...glanceTargetKeys(board)]).toEqual(['acme/app#2', 'acme/app#1', 'acme/app#3']);
  });
});
