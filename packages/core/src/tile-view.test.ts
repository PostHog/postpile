import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeUserState, NO_PR_FACTS, viewer } from './fixtures.ts';
import { buildPrSummary, notDonePrKeys, type PrSummaryInput } from './tile-view.ts';
import type { Pr, PrEvent, TileMember, TileState } from './types.ts';
import type { PrSummary } from './views.ts';

const pinged: TileMember['provenance'] = { kind: 'pinged', reason: 'subscribed' };

function summaryInput(pr: Pr, events: PrEvent[], overrides: Partial<PrSummaryInput> = {}): PrSummaryInput {
  return {
    pr,
    member: { prKey: pr.key, provenance: pinged },
    viewer,
    userState: null,
    events,
    reason: 'subscribed',
    glance: null,
    glanceStale: false,
    glanceGap: null,
    glanceState: 'none',
    quietRepo: false,
    repoLabel: null,
    tileUnread: false,
    now: at(100),
    pendingWrite: null,
    ...overrides,
  };
}

describe('buildPrSummary: done, turn and afterRead per PR', () => {
  const comment = makeEvent({ prKey: 'acme/app#1', kind: 'comment', actor: 'bob', at: at(20), ruleLoudness: 'loud', seenAt: at(30) });

  it('is not done until the PR is handled, and a mark-read of it would make it done', () => {
    const pr = makePr({ author: 'ada' });
    const summary = buildPrSummary(summaryInput(pr, [comment]));
    expect(summary.done).toBe(false);
    expect(summary.afterRead.done).toBe(true);
    expect(summary.turn.kind).toBe('none');
    const handled = buildPrSummary(summaryInput(pr, [comment], { userState: makeUserState({ prKey: pr.key, handledAt: at(40) }) }));
    expect(handled.done).toBe(true);
  });

  it('carries the PR own whose turn, without the PR number', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [viewer.login] });
    const summary = buildPrSummary(summaryInput(pr, []));
    expect(summary.turn).toMatchObject({ kind: 'you', move: 'review', what: 'Review' });
    expect(summary.afterRead.done).toBe(false);
  });

  it('reads a NOT_YOURS glance like the tile does', () => {
    const routed = makePr({ author: 'ada', reviewerTeams: ['acme/team-platform'] });
    expect(buildPrSummary(summaryInput(routed, [])).turn.kind).toBe('you');
    const notYours = buildPrSummary(summaryInput(routed, [], { glance: { verdict: 'NOT_YOURS', forYou: 'not yours' } }));
    expect(notYours.turn.kind).toBe('none');
    expect(notYours.afterRead.done).toBe(true);
  });

  it('never calls a pulled-in stack layer done after a mark-read', () => {
    const pr = makePr({ author: 'ada' });
    const layer = buildPrSummary(summaryInput(pr, [comment], { member: { prKey: pr.key, provenance: { kind: 'pulled_in', reason: 'stack layer' } } }));
    expect(layer.afterRead.done).toBe(false);
  });
});

/** A hand-built row of a set: rowan's open PR, pinged, not done, nothing unseen. */
function row(number: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    key: `acme/app#${number}`,
    title: `PR ${number}`,
    url: '',
    author: 'rowan',
    assignees: [],
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
    forYou: null,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: { kind: 'none', who: null, what: '', prKey: null },
    facts: NO_PR_FACTS,
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    whatsNew: null,
    updatedAt: at(number),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

/** The tile's state and rows: unread when a row has unseen loud news, else open. */
function dotsOf(prs: PrSummary[], kind?: TileState['kind']): string[] {
  const unread = prs.some((pr) => pr.unseenLoudEvents > 0);
  return notDonePrKeys({ state: { kind: kind ?? (unread ? 'unread' : 'open'), unreadBecause: [] }, prs });
}

describe('notDonePrKeys: the Not done yet dots', () => {
  const done = { done: true };
  const pulled = { provenance: { kind: 'pulled_in', reason: 'stack layer below #2' } } as const;

  it('dots every tracked PR that is not done, on an open tile too', () => {
    expect(dotsOf([row(1), row(2, done), row(3)])).toEqual(['acme/app#1', 'acme/app#3']);
  });

  it('dots a done PR that still has an unseen loud event: it keeps the tile unread', () => {
    expect(dotsOf([row(1, done), row(2, { ...done, unseenLoudEvents: 2 })])).toEqual(['acme/app#2']);
  });

  it('dots a pulled-in stack layer only while it has unseen loud news', () => {
    expect(dotsOf([row(1, done), row(2, done), row(3, pulled)])).toEqual([]);
    // Decided 2026-09-30: the layer's news makes the tile unread, so the layer says it holds the tile.
    expect(dotsOf([row(1, done), row(2, { ...pulled, unseenLoudEvents: 1 })])).toEqual(['acme/app#2']);
    expect(dotsOf([row(1), row(2, { ...pulled, unseenLoudEvents: 1 })])).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('dots nothing where only one PR can hold the tile: it would only repeat the tile state', () => {
    expect(dotsOf([row(1)])).toEqual([]);
    expect(dotsOf([row(1, { unseenLoudEvents: 1 })])).toEqual([]);
    // A stack with one pinged layer and quiet pulled-in context.
    expect(dotsOf([row(1), row(2, pulled)])).toEqual([]);
  });

  it('dots nothing on a done or snoozed tile', () => {
    for (const kind of ['done', 'snoozed'] as const) {
      expect(dotsOf([row(1), row(2), row(3, { ...pulled, unseenLoudEvents: 1 })], kind)).toEqual([]);
    }
  });

  it('follows the set as its PRs are marked done in the detail pane, one at a time', () => {
    // A set of three: #1 was read (nothing asks, not handled yet), #2 asks for a review, #3 is merged.
    const rows = [row(1), row(2), row(3, { ...done, state: 'MERGED' })];
    expect(dotsOf(rows)).toEqual(['acme/app#1', 'acme/app#2']);
    // #1 marked done in the detail pane: its dot goes, #2 still keeps the set open.
    const afterFirst = rows.map((pr) => (pr.key === 'acme/app#1' ? { ...pr, done: true } : pr));
    expect(dotsOf(afterFirst)).toEqual(['acme/app#2']);
    // The last one done: no dots left, and a done tile shows none either.
    const allDone = afterFirst.map((pr) => ({ ...pr, done: true }));
    expect(dotsOf(allDone)).toEqual([]);
    expect(dotsOf(allDone, 'done')).toEqual([]);
  });
});
