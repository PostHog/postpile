import { describe, expect, it } from 'vitest';
import type { Review } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { approveButton, approveStateGlyphs, type ApproveButtonInput } from './approve.ts';

function review(author: string, state: Review['state'], commitOid: string | null = null, minute = 10): Review {
  return { id: `${author}-${state}-${minute}`, author, state, body: '', submittedAt: at(minute), commitOid };
}

function input(overrides: Partial<ApproveButtonInput> = {}): ApproveButtonInput {
  return {
    isDraft: false,
    viewerLogin: 'viewer',
    reviews: [],
    approval: null,
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

  it('reads Approve as well after an agent approval too', () => {
    expect(approveButton(input({ reviews: [review('reviewbot[bot]', 'APPROVED')] })).label).toBe('Approve as well');
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
    const look = approveButton(input({ reviews: [review('lyra', 'APPROVED')], approval: { at: at(10), commitOid: 'head' } }));
    expect(look).toEqual({ label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: false });
  });

  it('counts an approval on an older commit and flags the moved head', () => {
    const look = approveButton(input({ approval: { at: at(5), commitOid: 'old' } }));
    expect(look).toEqual({ label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: true });
  });

  it('lets an earlier approval win over draft', () => {
    expect(approveButton(input({ isDraft: true, approval: { at: at(5), commitOid: 'head' } })).label).toBe('Approve again');
  });

  it('does not flag a moved head when the approved commit is unknown', () => {
    expect(approveButton(input({ approval: { at: at(5), commitOid: null } })).headMoved).toBe(false);
  });
});

describe('approveStateGlyphs', () => {
  it('shows lifecycle and review state', () => {
    expect(approveStateGlyphs('open', 'APPROVED', [])).toEqual([
      { glyph: 'ready', title: 'Open and ready for review' },
      { glyph: 'check', title: 'Approved' },
    ]);
  });

  it('keeps the review glyph on drafts', () => {
    expect(approveStateGlyphs('draft', 'REVIEW_REQUIRED', []).map((part) => part.glyph)).toEqual(['draft', 'eye']);
  });

  it('leaves out the review glyph without a review rule', () => {
    expect(approveStateGlyphs('open', 'NONE', []).map((part) => part.glyph)).toEqual(['ready']);
  });

  it('shows changes requested', () => {
    expect(approveStateGlyphs('open', 'CHANGES_REQUESTED', [])[1]).toEqual({ glyph: 'changes', title: 'Changes requested' });
  });

  it('names the agent in the tooltip when only an agent approved', () => {
    expect(approveStateGlyphs('open', 'APPROVED', ['reviewbot'])[1]).toEqual({ glyph: 'check', title: 'Approved by reviewbot (agent)' });
  });
});
