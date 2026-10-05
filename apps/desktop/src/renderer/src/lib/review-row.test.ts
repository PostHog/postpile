import { describe, expect, it } from 'vitest';
import { at, makePr, makeReview } from '@postpile/core/fixtures';
import { reviewRowLabel, type ReviewRowInput } from './review-row.ts';

function input(overrides: Partial<ReviewRowInput> = {}): ReviewRowInput {
  return { pr: makePr(), viewerLogin: 'viewer', approval: null, askedTeams: [], now: new Date(at(180)), ...overrides };
}

describe('reviewRowLabel', () => {
  it('says when the viewer approved, and that commits came after', () => {
    expect(reviewRowLabel(input({ approval: { at: at(60), commitOid: 'head' } }))).toEqual({ text: 'You approved 2h ago', tone: 'approved' });
    expect(reviewRowLabel(input({ approval: { at: at(60), commitOid: 'old' } })).text).toBe('You approved 2h ago, commits since');
  });

  it('says the viewer requested changes when that is their newest verdict', () => {
    const reviews = [makeReview({ author: 'viewer', state: 'APPROVED', submittedAt: at(10) }), makeReview({ author: 'viewer', state: 'CHANGES_REQUESTED', submittedAt: at(20) })];
    expect(reviewRowLabel(input({ pr: makePr({ reviews }) }))).toEqual({ text: 'You requested changes', tone: 'changes' });
  });

  it('names a review request for the viewer before one for their team', () => {
    expect(reviewRowLabel(input({ pr: makePr({ reviewerUsers: ['viewer'] }), askedTeams: ['team-devex'] })).text).toBe('Review requested from you');
    expect(reviewRowLabel(input({ askedTeams: ['acme/team-devex'] })).text).toBe('Review requested from team-devex');
  });

  it('falls back to the own PR, then a plain label', () => {
    expect(reviewRowLabel(input({ pr: makePr({ author: 'viewer' }) }))).toEqual({ text: 'Your PR', tone: 'plain' });
    expect(reviewRowLabel(input())).toEqual({ text: 'Your review', tone: 'plain' });
  });
});
