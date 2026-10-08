import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeUserState, NO_OPENED_READ, NO_OPENED_READ_INPUT, NO_PR_FACTS, viewer } from './fixtures.ts';
import { tileVerdict } from './tile-verdict.ts';
import { buildPrSummary, tileUnreadPrKeys, type PrSummaryInput } from './tile-view.ts';
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
    glanceRefreshBlock: null,
    glanceState: 'none',
    quietRepo: false,
    repoLabel: null,
    tileUnread: false,
    unreadOnGitHub: false,
    lastReadAt: null,
    now: at(100),
    pendingWrite: null,
    opened: NO_OPENED_READ_INPUT,
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
    const notYours = buildPrSummary(summaryInput(routed, [], { glance: { verdict: 'NOT_YOURS', forYou: 'not yours', risk: 'low' } }));
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
    status: { lifecycle: 'open', review: 'review', agentApprovers: [], mergeQueue: null, icon: 'open' },
    openThreads: 0,
    verdict: 'LOOKS_SAFE',
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceRefreshBlock: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    unreadOnGitHub: false,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: { kind: 'none', who: null, what: '', prKey: null },
    facts: NO_PR_FACTS,
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    openedRead: NO_OPENED_READ,
    whatsNew: null,
    updatedAt: at(number),
    fetchedAt: null,
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

const reason = (prKey: string) => ({ prKey, eventId: 'e', kind: 'comment' as const, actor: 'ada', summary: 'x', at: at(1), automation: false, loud: false, importance: 0 });

/** The dots of a tile in `kind`, whose unread reasons name `reasons`; rows with an unread thread count as thread keys. */
function dotsOf(prs: PrSummary[], kind: TileState['kind'], reasons: string[] = []): string[] {
  return tileUnreadPrKeys({ kind, unreadBecause: reasons.map(reason), unreadOnGitHub: prs.some((pr) => pr.unreadOnGitHub), loud: false }, prs);
}

describe('tileUnreadPrKeys: the unread dots', () => {
  const pulled = { provenance: { kind: 'pulled_in', reason: 'stack layer below #2' } } as const;

  it('dots every PR whose thread is unread on GitHub, single-PR tiles too', () => {
    expect(dotsOf([row(1, { unreadOnGitHub: true }), row(2), row(3, { unreadOnGitHub: true })], 'unread')).toEqual(['acme/app#1', 'acme/app#3']);
    expect(dotsOf([row(1, { unreadOnGitHub: true })], 'unread')).toEqual(['acme/app#1']);
  });

  it('dots a pulled-in layer or a Look closer PR the tile is unread by, read thread or not', () => {
    expect(dotsOf([row(1), row(2, pulled)], 'unread', ['acme/app#2'])).toEqual(['acme/app#2']);
    expect(dotsOf([row(1), row(2)], 'unread', ['acme/app#1', 'acme/app#1'])).toEqual(['acme/app#1']);
  });

  it('dots nothing that is only not done or only owed: that is the honey Your move', () => {
    expect(dotsOf([row(1), row(2, { unseenLoudEvents: 1 })], 'open')).toEqual([]);
    expect(dotsOf([row(1), row(2)], 'done')).toEqual([]);
  });

  it('keeps the unread threads of a snoozed tile dotted', () => {
    expect(dotsOf([row(1, { unreadOnGitHub: true }), row(2)], 'snoozed')).toEqual(['acme/app#1']);
  });
});

describe('tileVerdict: the tile pill shows the worst open tracked glance', () => {
  it('says Look closer on a stack whose lead looks safe but whose layer 3 needs a look', () => {
    const stack = [row(1), row(2), row(3, { verdict: 'LOOK_CLOSER' })];
    expect(tileVerdict(stack, 'acme/app#1')).toMatchObject({ prKey: 'acme/app#3', verdict: 'LOOK_CLOSER' });
  });

  it('lets a stale glance beat Looks safe', () => {
    const verdict = tileVerdict([row(1), row(2, { glanceStale: true })], 'acme/app#1');
    expect(verdict).toMatchObject({ prKey: 'acme/app#2', verdict: 'LOOKS_SAFE', glanceStale: true });
  });

  it('keeps the lead PR when nothing tracked is open, and leaves pulled-in layers out', () => {
    const merged = { state: 'MERGED' as const };
    expect(tileVerdict([row(1, { ...merged, verdict: 'NOT_YOURS' }), row(2, { ...merged, verdict: 'LOOK_CLOSER' })], 'acme/app#1')).toMatchObject({ prKey: 'acme/app#1' });
    const pulled = { provenance: { kind: 'pulled_in', reason: 'stack layer below #2' } } as const;
    expect(tileVerdict([row(1, { ...pulled, verdict: 'LOOK_CLOSER' }), row(2)], 'acme/app#2')).toMatchObject({ prKey: 'acme/app#2', verdict: 'LOOKS_SAFE' });
  });
});
