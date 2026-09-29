import { describe, expect, it } from 'vitest';
import type { PrSet, PrSummary, TileView, WhatsNew } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { countPrs, isDraftTile, isFyiNews, kindLabel, leadPr, notDonePrKeys, sameForWhom, stripMoreCount, stripNews, tileForYou } from './tiles.ts';

function summary(number: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: `acme/app#${number}`,
    title: `PR ${number}`,
    url: '',
    author: 'rowan',
    state: 'OPEN',
    primaryAction: 'approve',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    authorRelation: 'team',
    status: { lifecycle: 'open', review: 'review', agentApprovers: [] },
    openThreads: 0,
    verdict: 'LOOKS_SAFE',
    glanceStale: false,
    forYou: `for you ${number}`,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    done: false,
    ownTeamRequests: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    whatsNew: null,
    updatedAt: at(number),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function setView(prs: PrSummary[], unreadKeys: string[] = []): TileView {
  return {
    tile: { id: 'set:s1', topicId: 't1', kind: 'set', title: 'Cache PRs', members: [], stacks: [] },
    state: {
      kind: unreadKeys.length > 0 ? 'unread' : 'open',
      unreadBecause: unreadKeys.map((prKey, index) => ({ prKey, eventId: `e${index}`, kind: 'mention', actor: 'lyra', summary: 'x', at: at(index) })),
    },
    prs,
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'to_review',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  };
}

const pulled = { kind: 'pulled_in', reason: 'same cache keys' } as const;

describe('own PR helpers', () => {
  const mine = (number: number) => summary(number, { authorRelation: 'you' });

  it('calls news on your own PR FYI unless whose-turn says it is your move', () => {
    const view = setView([mine(1)], ['acme/app#1']);
    expect(isFyiNews(view)).toBe(true);
    expect(isFyiNews({ ...view, turn: { kind: 'you', move: 'address_changes', who: null, what: 'Answer 1 thread', prKey: 'acme/app#1' } })).toBe(false);
    expect(isFyiNews(setView([summary(1)], ['acme/app#1']))).toBe(false);
    expect(isFyiNews(setView([mine(1)]))).toBe(false);
  });
});

describe('isDraftTile', () => {
  it('is a draft tile when every open tracked PR is a draft', () => {
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2, { isDraft: true, provenance: pulled })]))).toBe(true);
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2)]))).toBe(false);
    expect(isDraftTile(setView([summary(1, { isDraft: true }), summary(2, { state: 'MERGED' })]))).toBe(true);
    expect(isDraftTile(setView([summary(1, { state: 'MERGED' })]))).toBe(false);
  });
});

describe('tile helpers', () => {
  it('picks the PR behind the newest unread reason as the lead', () => {
    const view = setView([summary(1), summary(2), summary(3)], ['acme/app#1', 'acme/app#3']);
    expect(leadPr(view)?.key).toBe('acme/app#3');
  });

  it('prefers the PR of the tile turn, so the verdict pill talks about the footer PR', () => {
    const turn = { kind: 'them' as const, who: 'rowan', what: 'to merge on #2', prKey: 'acme/app#2' };
    const view = { ...setView([summary(1), summary(2), summary(3)], ['acme/app#3']), turn };
    expect(leadPr(view)?.key).toBe('acme/app#2');
    // No turn: the newest unread reason again.
    expect(leadPr({ ...view, turn: { kind: 'none', who: null, what: '', prKey: null } })?.key).toBe('acme/app#3');
  });

  it('falls back to the first open pinged PR', () => {
    const view = setView([summary(1, { provenance: pulled }), summary(2, { state: 'MERGED' }), summary(3)]);
    expect(leadPr(view)?.key).toBe('acme/app#3');
  });

  it('compares "for whom" by kind and team', () => {
    expect(sameForWhom({ kind: 'you' }, { kind: 'you' })).toBe(true);
    expect(sameForWhom({ kind: 'team', team: 'a/x' }, { kind: 'team', team: 'a/x' })).toBe(true);
    expect(sameForWhom({ kind: 'team', team: 'a/x' }, { kind: 'team', team: 'a/y' })).toBe(false);
    expect(sameForWhom({ kind: 'you' }, { kind: 'own' })).toBe(false);
  });

  it('labels kinds', () => {
    const view = setView([summary(1), summary(2, { provenance: pulled }), summary(3, { provenance: pulled })]);
    expect(kindLabel(view)).toBe('Set · 3');
  });

  it('uses the set take for set tiles and the lead for_you otherwise', () => {
    const view = setView([summary(1)]);
    const set = { id: 's1', take: 'All three touch Turbo cache keys.' } as PrSet;
    expect(tileForYou(view, [set])).toBe('All three touch Turbo cache keys.');
    expect(tileForYou(view, [])).toBe('for you 1');
  });

  it('counts a PR pinged in any tile as pinged, once', () => {
    const first = setView([summary(1), summary(2, { provenance: pulled })]);
    const second = setView([summary(2), summary(3, { provenance: pulled })]);
    expect(countPrs([first, second])).toEqual({ pinged: 2, found: 0, pulledIn: 1 });
  });

  it('counts found PRs apart, unless pinged elsewhere', () => {
    const found = { kind: 'found' as const, via: 'own_open' as const, reason: 'your open PR' };
    const view = setView([summary(1, { provenance: found }), summary(2), summary(3, { provenance: pulled })]);
    expect(countPrs([view])).toEqual({ pinged: 1, found: 1, pulledIn: 1 });
    expect(leadPr(setView([summary(4, { provenance: pulled, state: 'OPEN' }), summary(5, { provenance: found })]))?.key).toBe('acme/app#5');
  });
});

describe('strip news', () => {
  const news: WhatsNew = {
    anchor: { kind: 'changes_request', at: at(0) },
    lead: { kind: 'push', eventKind: 'commits_pushed', actor: 'pim', count: 3, summary: 'pim pushed' },
    extraCount: 1,
    actor: 'pim',
    newestAt: at(5),
  };

  it('takes whatsNew of the PR behind the newest unread reason', () => {
    const view = setView([summary(1), summary(2, { whatsNew: news })], ['acme/app#1', 'acme/app#2']);
    expect(stripNews(view)).toBe(news);
    expect(stripNews(setView([summary(1, { whatsNew: news }), summary(2)], ['acme/app#1', 'acme/app#2']))).toBeNull();
    expect(stripNews(setView([summary(1, { whatsNew: news })]))).toBeNull();
  });

  it('counts the lead PR\'s extras plus the other PRs\' unread events on a revisit', () => {
    const view = setView([summary(1), summary(2, { whatsNew: news })], ['acme/app#1', 'acme/app#2', 'acme/app#2', 'acme/app#2']);
    expect(stripMoreCount(view, news)).toBe(2);
    expect(stripMoreCount(view, null)).toBe(3);
    expect(stripMoreCount(setView([summary(1)]), null)).toBe(0);
  });
});

describe('notDonePrKeys', () => {
  const done = { done: true };

  it('dots every tracked PR that is not done, on an open tile too', () => {
    const prs = [summary(1), summary(2, done), summary(3)];
    expect([...notDonePrKeys(setView(prs))]).toEqual(['acme/app#1', 'acme/app#3']);
  });

  it('dots a done PR that still has an unseen loud event: it keeps the tile unread', () => {
    const prs = [summary(1, done), summary(2, { ...done, unseenLoudEvents: 2 })];
    expect([...notDonePrKeys(setView(prs, ['acme/app#2']))]).toEqual(['acme/app#2']);
  });

  it('never dots a pulled-in stack layer', () => {
    expect(notDonePrKeys(setView([summary(1, done), summary(2, done), summary(3, { provenance: pulled })])).size).toBe(0);
  });

  it('dots nothing on a tile with one tracked PR: it would only repeat the tile state', () => {
    expect(notDonePrKeys(setView([summary(1)])).size).toBe(0);
    expect(notDonePrKeys(setView([summary(1, { unseenLoudEvents: 1 })], ['acme/app#1'])).size).toBe(0);
    // A stack with one pinged layer and pulled-in context counts as one tracked PR.
    expect(notDonePrKeys(setView([summary(1), summary(2, { provenance: pulled })])).size).toBe(0);
  });

  it('dots nothing on a done or snoozed tile', () => {
    const prs = [summary(1)];
    for (const kind of ['done', 'snoozed'] as const) {
      expect(notDonePrKeys({ ...setView(prs), state: { kind, unreadBecause: [] } }).size).toBe(0);
    }
  });

  it('follows the set as its PRs are marked done in the detail pane, one at a time', () => {
    // A set of three: #1 was read (nothing asks, not handled yet), #2 asks for a review, #3 is merged.
    const rows = [summary(1), summary(2), summary(3, { ...done, state: 'MERGED' })];
    expect([...notDonePrKeys(setView(rows))]).toEqual(['acme/app#1', 'acme/app#2']);
    // #1 marked done in the detail pane: its dot goes, #2 still keeps the set open.
    const afterFirst = rows.map((pr) => (pr.key === 'acme/app#1' ? { ...pr, done: true } : pr));
    expect([...notDonePrKeys(setView(afterFirst))]).toEqual(['acme/app#2']);
    // The last one done: the tile turns done and shows no dots at all.
    const allDone = afterFirst.map((pr) => ({ ...pr, done: true }));
    expect([...notDonePrKeys(setView(allDone))]).toEqual([]);
    expect(notDonePrKeys({ ...setView(allDone), state: { kind: 'done', unreadBecause: [] } }).size).toBe(0);
  });
});
