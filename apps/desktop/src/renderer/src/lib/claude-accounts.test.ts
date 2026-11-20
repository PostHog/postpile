import { describe, expect, it } from 'vitest';
import type { ClaudeAccountView } from '@postpile/core';
import { claudeAccountsFooterText, claudeAccountStatus } from './claude-accounts.ts';

function account(change: Partial<ClaudeAccountView>): ClaudeAccountView {
  return { id: '/a', label: 'Acme · team', shortLabel: 'Acme', email: 'alice@acme.example', configDir: '/a', preferred: true, inUse: true, limitedUntil: null, ...change };
}

describe('claudeAccountStatus', () => {
  const now = new Date(2026, 10, 20, 10, 0);

  it('says when a limited account is back', () => {
    expect(claudeAccountStatus(account({ inUse: false, limitedUntil: new Date(2026, 10, 20, 15, 0).toISOString() }), now)).toBe('at limit, back 15:00');
    expect(claudeAccountStatus(account({ inUse: false, limitedUntil: new Date(2026, 10, 21, 9, 0).toISOString() }), now)).toBe('at limit, back Sat 09:00');
  });

  it('marks a fallback account in use, else shows the email', () => {
    expect(claudeAccountStatus(account({ preferred: false }), now)).toBe('in use');
    expect(claudeAccountStatus(account({}), now)).toBe('alice@acme.example');
  });
});

describe('claudeAccountsFooterText', () => {
  function account(id: string, shortLabel: string, inUse: boolean): ClaudeAccountView {
    return { id, label: shortLabel, shortLabel, email: null, configDir: id, preferred: false, inUse, limitedUntil: null };
  }

  it('hides with one account', () => {
    expect(claudeAccountsFooterText({ accounts: [account('/a', 'Acme', true)], fallback: true })).toBeNull();
  });

  it('names the account in use', () => {
    expect(claudeAccountsFooterText({ accounts: [account('/a', 'Acme', true), account('/b', 'Personal', false)], fallback: true })).toBe('Claude · Acme');
  });

  it('says which one is at its limit after a fallback', () => {
    expect(claudeAccountsFooterText({ accounts: [account('/a', 'Acme', false), account('/b', 'Personal', true)], fallback: true })).toBe(
      'Claude · Personal (Acme at limit)',
    );
  });

  it('says so when none is free', () => {
    expect(claudeAccountsFooterText({ accounts: [account('/a', 'Acme', false), account('/b', 'Personal', false)], fallback: false })).toBe(
      'Claude · Acme at limit',
    );
  });
});
