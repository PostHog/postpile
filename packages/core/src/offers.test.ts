import { describe, expect, it } from 'vitest';
import type { TileAfterRead } from './after-read.ts';
import { at, NO_PR_FACTS } from './fixtures.ts';
import { leadPrKey, paneOffers, tileFooterAction, tileOffers, type OfferPr, type OfferView } from './offers.ts';
import type { TileMember, TileStateKind } from './types.ts';
import type { WhoseTurn } from './whose-turn.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REREVIEW: WhoseTurn = { kind: 'you', move: 're_review', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1' };
const stillYours: TileAfterRead = { done: false, turn: REREVIEW };
const doneAfter: TileAfterRead = { done: true, turn: NONE };
const pinged = { kind: 'pinged', reason: 'review_requested' } as const;
const pulled = { kind: 'pulled_in', reason: 'stack layer' } as const;

function row(number: number, overrides: Partial<OfferPr> = {}): OfferPr {
  return {
    key: `acme/app#${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    provenance: pinged,
    state: 'OPEN',
    authorRelation: 'other',
    primaryAction: 'approve',
    done: false,
    turn: NONE,
    afterRead: doneAfter,
    unseenLoudEvents: 0,
    unreadOnGitHub: false,
    pendingWrite: null,
    ownTeamRequests: [],
    facts: NO_PR_FACTS,
    ...overrides,
  };
}

function view(kind: TileStateKind, turn: WhoseTurn, afterRead: TileAfterRead, prs: OfferPr[] = [row(1)]): OfferView {
  const members: TileMember[] = prs.map((pr) => ({ prKey: pr.key, provenance: pr.provenance }));
  return {
    tile: { id: 't1', topicId: 'topic', kind: prs.length > 1 ? 'set' : 'single', title: 'T', members, stacks: [] },
    state: { kind, unreadBecause: [], unreadOnGitHub: kind === 'unread', loud: kind === 'unread' },
    turn,
    afterRead,
    prs: prs as OfferView['prs'],
    pendingWrite: null,
  };
}

describe('tile footer', () => {
  it('says Mark read on an unread tile, Mark done only where a mark-read makes it done', () => {
    expect(tileOffers(view('unread', REREVIEW, stillYours)).markLabel).toBe('Mark read');
    expect(tileOffers(view('open', NONE, doneAfter)).markLabel).toBe('Mark done');
    expect(tileOffers(view('open', NONE, { done: false, turn: NONE })).markLabel).toBe('Mark read');
    expect(tileOffers(view('snoozed', NONE, doneAfter)).markLabel).toBe('Mark done');
  });

  it('leads with Snooze and a GitHub link on a read tile that is still your move', () => {
    const offers = tileOffers(view('open', REREVIEW, stillYours));
    expect(offers.footer).toBe('snooze');
    expect(offers.markLabel).toBeNull();
    expect(offers.github).toEqual({ label: 'Review on GitHub', url: 'https://github.com/acme/app/pull/1', filesTab: true });
    const own = tileOffers(view('open', REREVIEW, stillYours, [row(1, { authorRelation: 'you' })]));
    expect(own.github).toEqual({ label: 'Open on GitHub', url: 'https://github.com/acme/app/pull/1', filesTab: false });
  });

  it('opens a done tile and offers nothing else', () => {
    expect(tileFooterAction(view('done', NONE, doneAfter))).toBe('open');
    expect(tileOffers(view('done', NONE, { done: false, turn: NONE }))).toMatchObject({ markLabel: null, snooze: false });
  });

  // Bug fixed 2026-09-29: the footer still said "Mark done" where the pane led with Open.
  it('opens a snoozed tile whose tracked PRs are all done, keeping Snooze to take it back', () => {
    const offers = tileOffers(view('snoozed', NONE, doneAfter, [row(1, { done: true }), row(2, { provenance: pulled })]));
    expect(offers).toMatchObject({ footer: 'open', markLabel: null, snooze: true, github: null });
    const news = tileOffers(view('snoozed', NONE, doneAfter, [row(1, { done: true, unseenLoudEvents: 1 })]));
    expect(news).toMatchObject({ footer: 'mark_done', snooze: true });
    const unreadThread = tileOffers(view('snoozed', NONE, doneAfter, [row(1, { done: true, unreadOnGitHub: true })]));
    expect(unreadThread).toMatchObject({ footer: 'mark_done', snooze: true });
  });

  it('keeps Mark read for a done PR whose thread is unread on GitHub, on the tile and in the pane', () => {
    const doneRow = row(1, { done: true, unreadOnGitHub: true, primaryAction: 'mark_read' });
    expect(tileOffers(view('unread', NONE, doneAfter, [doneRow])).footer).toBe('mark_read');
    const set = view('unread', NONE, doneAfter, [doneRow, row(2, { done: true })]);
    expect(paneOffers(set, doneRow).markLabel).toBe('Mark read');
    expect(paneOffers(set, row(2, { done: true })).lead).toBe('open_on_github');
  });
});

describe('lead PR', () => {
  function unread(prs: OfferPr[], unreadKeys: string[], turn: WhoseTurn = NONE) {
    const base = view('unread', turn, doneAfter, prs);
    const unreadBecause = unreadKeys.map((prKey, index) => ({ prKey, eventId: `e${index}`, kind: 'mention' as const, actor: 'lyra', summary: 'x', at: at(index), automation: false, loud: true }));
    return { ...base, state: { kind: 'unread' as const, unreadBecause, unreadOnGitHub: true, loud: true } };
  }

  it('is the PR of the turn, else the newest unread reason, else the first open tracked PR', () => {
    const prs = [row(1), row(2), row(3)];
    expect(leadPrKey(unread(prs, ['acme/app#3'], { kind: 'them', who: 'rowan', what: 'to merge', prKey: 'acme/app#2' }))).toBe('acme/app#2');
    expect(leadPrKey(unread(prs, ['acme/app#1', 'acme/app#3']))).toBe('acme/app#3');
    expect(leadPrKey(view('open', NONE, doneAfter, [row(1, { provenance: pulled }), row(2, { state: 'MERGED' }), row(3)]))).toBe('acme/app#3');
  });
});

describe('detail pane', () => {
  it('on a single-PR tile follows the tile, with Approve leading while it is due', () => {
    expect(paneOffers(view('unread', NONE, doneAfter), row(1)).lead).toBe('approve');
    const approved = row(1, { primaryAction: 'approved' });
    expect(paneOffers(view('unread', NONE, doneAfter, [approved]), approved).lead).toBe('mark_read');
    expect(paneOffers(view('open', REREVIEW, stillYours, [approved]), approved)).toMatchObject({ lead: 'snooze', snooze: true, markLabel: null });
    const draft = row(1, { isDraft: true });
    expect(paneOffers(view('open', NONE, doneAfter, [draft]), draft)).toMatchObject({ lead: 'mark_done', approve: true });
  });

  it('on a stack or set acts on the selected PR, never offering Snooze', () => {
    const yours = row(2, { turn: REREVIEW, afterRead: stillYours, primaryAction: 'approved' });
    const set = view('open', REREVIEW, stillYours, [row(1, { primaryAction: 'approved' }), yours]);
    expect(paneOffers(set, set.prs[0]!)).toMatchObject({ scope: 'pr', lead: 'mark_done', markLabel: 'Mark done', snooze: false });
    expect(paneOffers(set, yours)).toMatchObject({ lead: 'open_on_github', markLabel: null, open: true });
    const quietLayer = row(3, { provenance: pulled, primaryAction: 'approved' });
    expect(paneOffers(view('open', NONE, doneAfter, [row(1), quietLayer]), quietLayer).markLabel).toBeNull();
  });

  it('waits on the selected PR own pending write on a set, the tile one on a single PR', () => {
    const pending = { since: at(0), error: null };
    const set = { ...view('open', NONE, doneAfter, [row(1), row(2, { pendingWrite: pending })]), pendingWrite: pending };
    expect(paneOffers(set, set.prs[0]!).pendingWrite).toBeNull();
    expect(paneOffers(set, set.prs[1]!).pendingWrite).toBe(pending);
    const single = { ...view('open', NONE, doneAfter), pendingWrite: pending };
    expect(paneOffers(single, row(1)).pendingWrite).toBe(pending);
  });

  // Bug fixed 2026-09-29: a handled PR by someone else with no ask was done but still got a primary Approve, plus Ask.
  it('offers only Open on a done PR, also on a set whose other PR is still open', () => {
    const done = row(2, { done: true, ownTeamRequests: ['acme/team-platform'] });
    const set = view('open', REREVIEW, stillYours, [row(1, { turn: REREVIEW }), done]);
    expect(paneOffers(set, done)).toEqual({
      scope: 'pr',
      lead: 'open_on_github',
      approve: false,
      open: true,
      ask: false,
      markLabel: null,
      snooze: false,
      removeTeams: [],
      pendingWrite: null,
    });
    expect(paneOffers(view('done', NONE, doneAfter), row(1, { done: true }))).toMatchObject({ lead: 'open_on_github', approve: false, ask: false, snooze: false, markLabel: null });
  });

  it('keeps Mark read on a done PR whose news keeps the tile unread, without Approve', () => {
    const done = row(1, { done: true, unseenLoudEvents: 1 });
    expect(paneOffers(view('unread', NONE, doneAfter, [done]), done)).toMatchObject({ lead: 'mark_read', approve: false, ask: false });
  });

  it('asks no automation account and never the viewer', () => {
    const bot = row(1, { facts: { ...NO_PR_FACTS, owners: ['renovate[bot]'], ownerIsAutomation: true } });
    expect(paneOffers(view('unread', NONE, doneAfter, [bot]), bot).ask).toBe(false);
    const own = row(1, { authorRelation: 'you', primaryAction: 'mark_read' });
    expect(paneOffers(view('unread', NONE, doneAfter, [own]), own)).toMatchObject({ ask: false, approve: false, open: false, lead: 'mark_read' });
    expect(paneOffers(view('unread', NONE, doneAfter), row(1)).ask).toBe(true);
  });
});
