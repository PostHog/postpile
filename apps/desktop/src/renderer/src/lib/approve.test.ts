import { describe, expect, it } from 'vitest';
import type { Review } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { approveButton, approveStateGlyphs, viewerApprovedAt, type ApproveButtonInput } from './approve.ts';

function review(author: string, state: Review['state'], commitOid: string | null = null, minute = 10): Review {
  return { id: `${author}-${state}-${minute}`, author, state, body: '', submittedAt: at(minute), commitOid };
}

function input(overrides: Partial<ApproveButtonInput> = {}): ApproveButtonInput {
  return {
    isDraft: false,
    viewerLogin: 'viewer',
    reviews: [],
    viewerApprovedAt: null,
    viewerApprovedCommitOid: null,
    headOid: 'head',
    ...overrides,
  };
}

const fresh = { viewerApproved: false, headMoved: false };

describe('approveButton', () => {
  it('reads plain Approve when nobody approved yet', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'COMMENTED')] }))).toEqual({ label: 'Approve', variant: 'primary', ...fresh });
  });

  it('reads Approve as well when others approved and the viewer never did', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'APPROVED')] }))).toEqual({ label: 'Approve as well', variant: 'primary', ...fresh });
  });

  it('ignores dismissed approvals from others', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'DISMISSED')] })).label).toBe('Approve');
  });

  it('reads Approve draft, outlined, on a draft', () => {
    expect(approveButton(input({ isDraft: true }))).toEqual({ label: 'Approve draft', variant: 'secondary', ...fresh });
  });

  it('lets draft win over as well', () => {
    expect(approveButton(input({ isDraft: true, reviews: [review('lyra', 'APPROVED')] })).label).toBe('Approve draft');
  });

  it('reads Approve again, outlined, when the viewer approved the head', () => {
    const reviews = [review('lyra', 'APPROVED'), review('viewer', 'APPROVED', 'head')];
    expect(approveButton(input({ reviews }))).toEqual({ label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: false });
  });

  it('counts an approval on an older commit and flags the moved head', () => {
    const reviews = [review('lyra', 'APPROVED', 'head'), review('viewer', 'APPROVED', 'old')];
    expect(approveButton(input({ reviews }))).toEqual({ label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: true });
  });

  it('counts the app record of an approval on any commit', () => {
    const look = approveButton(input({ reviews: [review('lyra', 'APPROVED')], viewerApprovedAt: at(5), viewerApprovedCommitOid: 'old' }));
    expect(look).toEqual({ label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: true });
  });

  it('does not count a dismissed approval by the viewer', () => {
    expect(approveButton(input({ reviews: [review('viewer', 'DISMISSED')] })).label).toBe('Approve');
  });

  it('lets an earlier approval win over draft', () => {
    expect(approveButton(input({ isDraft: true, reviews: [review('viewer', 'APPROVED', 'head')] })).label).toBe('Approve again');
  });

  it('does not flag a moved head when the approved commit is unknown', () => {
    expect(approveButton(input({ reviews: [review('viewer', 'APPROVED')] })).headMoved).toBe(false);
  });
});

describe('viewerApprovedAt', () => {
  it('prefers the app record, else the newest approving review', () => {
    expect(viewerApprovedAt(input({ viewerApprovedAt: at(5), reviews: [review('viewer', 'APPROVED')] }))).toBe(at(5));
    expect(viewerApprovedAt(input({ reviews: [review('viewer', 'APPROVED')] }))).toBe(at(10));
    expect(viewerApprovedAt(input())).toBeNull();
  });
});

describe('approveStateGlyphs', () => {
  it('shows lifecycle and review state', () => {
    expect(approveStateGlyphs('open', 'APPROVED')).toEqual([
      { glyph: 'ready', title: 'Open and ready for review' },
      { glyph: 'check', title: 'Approved' },
    ]);
  });

  it('keeps the review glyph on drafts', () => {
    expect(approveStateGlyphs('draft', 'REVIEW_REQUIRED').map((part) => part.glyph)).toEqual(['draft', 'eye']);
  });

  it('leaves out the review glyph without a review rule', () => {
    expect(approveStateGlyphs('open', 'NONE').map((part) => part.glyph)).toEqual(['ready']);
  });

  it('shows changes requested', () => {
    expect(approveStateGlyphs('open', 'CHANGES_REQUESTED')[1]).toEqual({ glyph: 'changes', title: 'Changes requested' });
  });
});

describe('approveButton after a request for changes', () => {
  it('treats a later request changes from the viewer as undoing the approval', () => {
    const reviews = [review('viewer', 'APPROVED', 'a', 10), review('viewer', 'CHANGES_REQUESTED', 'b', 20)];
    expect(approveButton(input({ reviews })).label).toBe('Approve');
  });

  it('lets a request changes newer than the app record undo that record too', () => {
    const reviews = [review('viewer', 'CHANGES_REQUESTED', 'b', 20)];
    expect(approveButton(input({ reviews, viewerApprovedAt: at(10) })).label).toBe('Approve');
    expect(viewerApprovedAt(input({ reviews, viewerApprovedAt: at(10) }))).toBeNull();
  });

  it('keeps the approval when it came after the viewer asked for changes', () => {
    const reviews = [review('viewer', 'CHANGES_REQUESTED', 'a', 10), review('viewer', 'APPROVED', 'b', 20)];
    expect(approveButton(input({ reviews })).label).toBe('Approve again');
  });
});
