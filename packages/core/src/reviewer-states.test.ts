import { describe, expect, it } from 'vitest';
import { at, makePr, makeReview } from './fixtures.ts';
import { reviewerStates } from './reviewer-states.ts';

describe('reviewerStates', () => {
  it('splits people from agents and lists who is still asked', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'alice', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: at(2) }),
        makeReview({ id: 'r3', author: 'reviewbot[bot]', state: 'CHANGES_REQUESTED', submittedAt: at(3) }),
      ],
      reviewerUsers: ['carol', 'copilot-reviewer[bot]'],
      reviewerTeams: ['acme/team-platform', 'acme/team-security'],
    });
    expect(reviewerStates(pr)).toEqual({
      approvedBy: ['alice'],
      changesRequestedBy: ['bob'],
      pendingUsers: ['carol'],
      pendingTeams: ['acme/team-platform', 'acme/team-security'],
      agents: [
        { name: 'reviewbot', state: 'changes_requested' },
        { name: 'copilot-reviewer', state: 'pending' },
      ],
    });
  });

  it('lets the latest deciding review win: a later approval replaces a change request', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'alice', state: 'APPROVED', submittedAt: at(2) }),
      ],
    });
    expect(reviewerStates(pr)).toMatchObject({ approvedBy: ['alice'], changesRequestedBy: [] });
  });

  it('drops dismissed reviews and gives plain comments no state', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'alice', state: 'APPROVED', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'alice', state: 'DISMISSED', submittedAt: at(2) }),
        makeReview({ id: 'r3', author: 'bob', state: 'COMMENTED', submittedAt: at(3) }),
        makeReview({ id: 'r4', author: 'reviewbot[bot]', state: 'COMMENTED', submittedAt: at(4) }),
      ],
    });
    expect(reviewerStates(pr)).toEqual({ approvedBy: [], changesRequestedBy: [], pendingUsers: [], pendingTeams: [], agents: [] });
  });

  it('keeps an approval through a later plain comment', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'alice', state: 'APPROVED', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'alice', state: 'COMMENTED', submittedAt: at(2) }),
      ],
    });
    expect(reviewerStates(pr).approvedBy).toEqual(['alice']);
  });

  it('shows a requested agent that already reviewed by its review only', () => {
    const pr = makePr({
      reviews: [makeReview({ id: 'r1', author: 'reviewbot[bot]', state: 'APPROVED', submittedAt: at(1) })],
      reviewerUsers: ['reviewbot[bot]'],
    });
    expect(reviewerStates(pr).agents).toEqual([{ name: 'reviewbot', state: 'approved' }]);
  });
});
