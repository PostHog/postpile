import { claudeAccountLabel, claudeAccountShortLabel, preferClaudeAccount, type ClaudeAccountsView, type ClaudeAuthStatus } from '@postpile/core';

/** Two invented logins, so the footer's Claude item shows on sample data. */
const SAMPLE_ACCOUNTS: { id: string; status: ClaudeAuthStatus }[] = [
  { id: '/Users/alice/.claude-acme', status: { loggedIn: true, orgName: 'Acme', subscriptionType: 'team', email: 'alice@acme.example' } },
  { id: 'default', status: { loggedIn: true, orgName: "alice@example.com's Organization", subscriptionType: 'max', email: 'alice@example.com' } },
];

/** With "claude-account-limit" in POSTPILE_FAKE_MISSING, the preferred account resets this long after start. */
const LIMIT_MS = 90 * 60_000;

/**
 * The Claude accounts of sample data: Acme preferred, Personal next. Picking
 * one and the fallback switch are kept in memory. `preferredLimited` puts the
 * first account at its limit, so the fallback look can be checked.
 */
export class FakeClaudeAccounts {
  private order = SAMPLE_ACCOUNTS.map((account) => account.id);
  private fallback = true;
  private readonly limitedUntil = new Map<string, number>();

  constructor(
    private readonly now: () => Date,
    preferredLimited: boolean,
  ) {
    if (preferredLimited) {
      this.limitedUntil.set(this.order[0] ?? '', now().getTime() + LIMIT_MS);
    }
  }

  view(): ClaudeAccountsView {
    const nowMs = this.now().getTime();
    const free = (id: string): boolean => (this.limitedUntil.get(id) ?? 0) <= nowMs;
    const usable = this.fallback ? this.order : this.order.slice(0, 1);
    const inUse = usable.find(free) ?? null;
    return {
      fallback: this.fallback,
      accounts: this.order.map((id, index) => {
        const status = SAMPLE_ACCOUNTS.find((account) => account.id === id)?.status ?? null;
        const until = this.limitedUntil.get(id);
        return {
          id,
          label: claudeAccountLabel(id, status),
          shortLabel: claudeAccountShortLabel(id, status),
          email: status?.email ?? null,
          configDir: id === 'default' ? null : id,
          preferred: index === 0,
          inUse: id === inUse,
          limitedUntil: until !== undefined && until > nowMs ? new Date(until).toISOString() : null,
        };
      }),
    };
  }

  setPreferred(id: string): ClaudeAccountsView {
    if (!this.order.includes(id)) {
      throw new Error(`no logged-in Claude account ${id}`);
    }
    this.order = preferClaudeAccount(this.order, id);
    return this.view();
  }

  setFallback(on: boolean): ClaudeAccountsView {
    this.fallback = on;
    return this.view();
  }
}
