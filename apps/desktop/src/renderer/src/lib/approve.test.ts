import { describe, expect, it } from 'vitest';
import type { Review } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { approveButton, approveStateGlyphs, type ApproveButtonInput } from './approve.ts';

function review(author: string, state: Review['state'], commitOid: string | null = null): Review {
  return { id: `${author}-${state}`, author, state, body: '', submittedAt: at(10), commitOid };
}

function input(overrides: Partial<ApproveButtonInput> = {}): ApproveButtonInput {
  return { primary: 'approve', isDraft: false, viewerLogin: 'viewer', reviews: [], viewerApprovedAt: null, ...overrides };
}

describe('approveButton', () => {
  it('reads plain Approve when nobody approved yet', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'COMMENTED')] }))).toEqual({ label: 'Approve', variant: 'primary' });
  });

  it('reads Approve as well when others approved and the viewer never did', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'APPROVED')] }))).toEqual({ label: 'Approve as well', variant: 'primary' });
  });

  it('ignores dismissed approvals from others', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'DISMISSED')] })).label).toBe('Approve');
  });

  it('reads Approve draft, outlined, on a draft', () => {
    expect(approveButton(input({ isDraft: true }))).toEqual({ label: 'Approve draft', variant: 'secondary' });
  });

  it('lets draft win over as well', () => {
    expect(approveButton(input({ isDraft: true, reviews: [review('lyra', 'APPROVED')] }))).toEqual({
      label: 'Approve draft',
      variant: 'secondary',
    });
  });

  it('keeps Approved while the viewer approval covers the head', () => {
    expect(approveButton(input({ primary: 'approved', reviews: [review('lyra', 'APPROVED')] }))).toEqual({
      label: 'Approved ✓',
      variant: 'primary',
    });
  });

  it('reads plain Approve when the viewer approved an older commit on github.com', () => {
    const reviews = [review('lyra', 'APPROVED', 'new'), review('viewer', 'APPROVED', 'old')];
    expect(approveButton(input({ reviews })).label).toBe('Approve');
  });

  it('reads plain Approve when the app recorded an older approval', () => {
    expect(approveButton(input({ reviews: [review('lyra', 'APPROVED')], viewerApprovedAt: at(5) })).label).toBe('Approve');
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
