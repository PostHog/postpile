import { describe, expect, it } from 'vitest';
import { canApprove, prPrimaryAction, type PrimaryActionInput } from './primary-action.ts';

const base: PrimaryActionInput = { state: 'OPEN', authorRelation: 'other', approvedHead: false, tileUnread: false };

describe('prPrimaryAction', () => {
  it('offers Approve on an open PR someone else wrote', () => {
    expect(prPrimaryAction(base)).toBe('approve');
    expect(prPrimaryAction({ ...base, authorRelation: 'team', tileUnread: true })).toBe('approve');
  });

  it('shows Approved once the head is approved, Approve again after a push', () => {
    expect(prPrimaryAction({ ...base, approvedHead: true })).toBe('approved');
    expect(prPrimaryAction({ ...base, approvedHead: false })).toBe('approve');
  });

  it('never offers Approve on your own PR', () => {
    expect(prPrimaryAction({ ...base, authorRelation: 'you' })).toBe('open_on_github');
    expect(prPrimaryAction({ ...base, authorRelation: 'you', tileUnread: true })).toBe('mark_read');
    expect(canApprove({ state: 'OPEN', authorRelation: 'you' })).toBe(false);
  });

  it('never offers Approve on merged or closed PRs', () => {
    expect(prPrimaryAction({ ...base, state: 'MERGED' })).toBe('open_on_github');
    expect(prPrimaryAction({ ...base, state: 'CLOSED', tileUnread: true })).toBe('mark_read');
    expect(canApprove({ state: 'MERGED', authorRelation: 'other' })).toBe(false);
  });
});
