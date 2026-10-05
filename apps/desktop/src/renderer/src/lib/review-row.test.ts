import { describe, expect, it } from 'vitest';
import { at, makePr } from '@postpile/core/fixtures';
import { reviewRowLabel, type ReviewRowInput } from './review-row.ts';

function input(overrides: Partial<ReviewRowInput> = {}): ReviewRowInput {
  return { pr: makePr(), approval: null, stand: null, askedTeams: [], now: new Date(at(180)), ...overrides };
}

describe('reviewRowLabel', () => {
  it('says when the viewer approved, and that commits came after', () => {
    expect(reviewRowLabel(input({ approval: { at: at(60), commitOid: 'head' } }))).toEqual({ text: 'You approved 2h ago', tone: 'approved' });
    expect(reviewRowLabel(input({ approval: { at: at(60), commitOid: 'old' } })).text).toBe('You approved 2h ago, commits since');
  });

  it('says the viewer requested changes', () => {
    expect(reviewRowLabel(input({ stand: 'changes_requested' }))).toEqual({ text: 'You requested changes', tone: 'changes' });
  });

  it('names a review request for the viewer before one for their team', () => {
    expect(reviewRowLabel(input({ stand: 'requested', askedTeams: ['team-devex'] })).text).toBe('Review requested from you');
    expect(reviewRowLabel(input({ askedTeams: ['acme/team-devex'] })).text).toBe('Review requested from team-devex');
  });

  it('falls back to the own PR, then a plain label', () => {
    expect(reviewRowLabel(input({ stand: 'own_pr' }))).toEqual({ text: 'Your PR', tone: 'plain' });
    expect(reviewRowLabel(input())).toEqual({ text: 'Your review', tone: 'plain' });
  });
});
