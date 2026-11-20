import { describe, expect, it } from 'vitest';
import {
  claudeAccountCandidates,
  claudeAccountLabel,
  claudeAccountOrder,
  claudeAccountShortLabel,
  normalizeClaudeAccountId,
  parseClaudeAuthStatus,
  pickClaudeAccount,
  preferClaudeAccount,
} from './claude-accounts.ts';

const home = '/Users/alice';

describe('parseClaudeAuthStatus', () => {
  it('reads the fields the menu needs', () => {
    const stdout = JSON.stringify({ loggedIn: true, orgName: 'Acme', subscriptionType: 'team', email: 'alice@example.com', configDirectory: '/x' });
    expect(parseClaudeAuthStatus(stdout)).toEqual({ loggedIn: true, orgName: 'Acme', subscriptionType: 'team', email: 'alice@example.com' });
  });

  it('keeps a logged-out answer and drops what is not JSON', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toEqual({ loggedIn: false, orgName: null, subscriptionType: null, email: null });
    expect(parseClaudeAuthStatus('Not logged in')).toBeNull();
    expect(parseClaudeAuthStatus('{"email":"a"}')).toBeNull();
  });
});

describe('normalizeClaudeAccountId', () => {
  it('expands ~ and drops a trailing slash, keeps "default"', () => {
    expect(normalizeClaudeAccountId('~/.claude-work/', home)).toBe('/Users/alice/.claude-work');
    expect(normalizeClaudeAccountId('/x///', home)).toBe('/x');
    expect(normalizeClaudeAccountId('/', home)).toBe('/');
    expect(normalizeClaudeAccountId('default', home)).toBe('default');
    // ~/.claude is a folder like any other, not the unset default.
    expect(normalizeClaudeAccountId('~/.claude', home)).toBe('/Users/alice/.claude');
  });
});

describe('claudeAccountCandidates', () => {
  it('lists the default, home folders, the env folder and configured ones once each', () => {
    expect(
      claudeAccountCandidates({
        home,
        homeConfigDirs: ['.claude-work', '.claude-alt', 'other'],
        envConfigDir: '/Users/alice/.claude-work/',
        configured: ['default', '~/elsewhere', '~/.claude-alt'],
      }),
    ).toEqual(['default', '/Users/alice/.claude-alt', '/Users/alice/.claude-work', '/Users/alice/elsewhere']);
  });
});

describe('claudeAccountOrder', () => {
  const found = ['default', '/a', '/b'];

  it('keeps discovery order, default first, without a list', () => {
    expect(claudeAccountOrder(found, [])).toEqual(['default', '/a', '/b']);
  });

  it('puts the listed accounts first, in list order, and skips ones not logged in', () => {
    expect(claudeAccountOrder(found, ['/b', '/gone', 'default'])).toEqual(['/b', 'default', '/a']);
  });
});

describe('preferClaudeAccount', () => {
  it('moves the picked account to the front', () => {
    expect(preferClaudeAccount(['default', '/a', '/b'], '/b')).toEqual(['/b', 'default', '/a']);
  });
});

describe('pickClaudeAccount', () => {
  const order = ['/a', '/b', '/c'];
  const now = 1_000_000;

  it('takes the first account that is not at its limit', () => {
    expect(pickClaudeAccount(order, new Map(), now, true)).toBe('/a');
    expect(pickClaudeAccount(order, new Map([['/a', now + 1]]), now, true)).toBe('/b');
  });

  it('uses a limited account again once its time is up', () => {
    expect(pickClaudeAccount(order, new Map([['/a', now]]), now, true)).toBe('/a');
  });

  it('gives null when every account is at its limit', () => {
    const limited = new Map(order.map((id) => [id, now + 1] as const));
    expect(pickClaudeAccount(order, limited, now, true)).toBeNull();
  });

  it('only tries the preferred account with fallback off', () => {
    expect(pickClaudeAccount(order, new Map([['/a', now + 1]]), now, false)).toBeNull();
    expect(pickClaudeAccount(order, new Map([['/b', now + 1]]), now, false)).toBe('/a');
  });
});

describe('labels', () => {
  it('names an org account by org and plan', () => {
    const status = { loggedIn: true, orgName: 'Acme', subscriptionType: 'team', email: null };
    expect(claudeAccountLabel('/a', status)).toBe('Acme · team');
    expect(claudeAccountShortLabel('/a', status)).toBe('Acme');
  });

  it('calls the one-person organization Personal', () => {
    const status = { loggedIn: true, orgName: "alice@example.com's Organization", subscriptionType: 'max', email: 'alice@example.com' };
    expect(claudeAccountLabel('default', status)).toBe('Personal · max');
  });

  it('falls back to the folder name without an org', () => {
    expect(claudeAccountLabel('/Users/alice/.claude-work', null)).toBe('.claude-work');
    expect(claudeAccountLabel('default', null)).toBe('Default');
  });
});
