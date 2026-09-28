import { describe, expect, it } from 'vitest';
import { agentOnlyApprovers, botName, standingApprovals } from './approvals.ts';
import { at, makePr, makeReview } from './fixtures.ts';
import { prStatus } from './pr-status.ts';

describe('standingApprovals', () => {
  it('splits approvals into people and agents', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'reviewbot[bot]', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'alice', submittedAt: at(2) }),
      ],
    });
    expect(standingApprovals(pr)).toEqual({ people: ['alice'], agents: ['reviewbot[bot]'] });
  });

  it('takes back an approval after a later change request or dismissal', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'alice', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: at(2) }),
        makeReview({ id: 'r3', author: 'reviewbot[bot]', submittedAt: at(3) }),
        makeReview({ id: 'r4', author: 'reviewbot[bot]', state: 'DISMISSED', submittedAt: at(4) }),
      ],
    });
    expect(standingApprovals(pr)).toEqual({ people: [], agents: [] });
  });

  it('keeps an approval through later plain comments', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'reviewbot[bot]', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'reviewbot[bot]', state: 'COMMENTED', submittedAt: at(2) }),
      ],
    });
    expect(standingApprovals(pr).agents).toEqual(['reviewbot[bot]']);
  });

  it('counts known automation accounts without the [bot] suffix as agents', () => {
    const pr = makePr({ reviews: [makeReview({ author: 'deploy-bot' })] });
    expect(standingApprovals(pr)).toEqual({ people: [], agents: ['deploy-bot'] });
  });
});

describe('agentOnlyApprovers', () => {
  it('names the agents only while no person approved', () => {
    expect(agentOnlyApprovers({ people: [], agents: ['reviewbot[bot]'] })).toEqual(['reviewbot']);
    expect(agentOnlyApprovers({ people: ['alice'], agents: ['reviewbot[bot]'] })).toEqual([]);
    expect(agentOnlyApprovers({ people: [], agents: [] })).toEqual([]);
  });
});

describe('botName', () => {
  it('drops the [bot] suffix', () => {
    expect(botName('reviewbot[bot]')).toBe('reviewbot');
    expect(botName('alice')).toBe('alice');
  });
});

describe('prStatus agentApprovers', () => {
  const agentOnly = [makeReview({ author: 'reviewbot[bot]' })];

  it('names the agents when GitHub counts the PR approved and only agents approved', () => {
    const pr = makePr({ reviewDecision: 'APPROVED', reviews: agentOnly });
    expect(prStatus(pr)).toMatchObject({ review: 'approved', agentApprovers: ['reviewbot'] });
  });

  it('stays empty once a person approved as well', () => {
    const pr = makePr({ reviewDecision: 'APPROVED', reviews: [...agentOnly, makeReview({ id: 'r2', author: 'alice', submittedAt: at(30) })] });
    expect(prStatus(pr).agentApprovers).toEqual([]);
  });

  it('follows GitHub: no approved review decision, no agent names', () => {
    expect(prStatus(makePr({ reviewDecision: 'REVIEW_REQUIRED', reviews: agentOnly })).agentApprovers).toEqual([]);
    expect(prStatus(makePr({ state: 'MERGED', reviewDecision: 'APPROVED', reviews: agentOnly })).agentApprovers).toEqual([]);
  });
});
