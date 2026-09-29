import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeUserState, viewer } from './fixtures.ts';
import { buildPrSummary, type PrSummaryInput } from './tile-view.ts';
import type { Pr, PrEvent, TileMember } from './types.ts';

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
