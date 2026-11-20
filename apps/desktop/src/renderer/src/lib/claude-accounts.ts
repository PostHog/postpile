import type { ClaudeAccountsView, ClaudeAccountView } from '@postpile/core';
import { clockLabel } from './time.ts';

/**
 * The quiet word next to an account in the footer menu: "at limit, back
 * 15:00" (with the weekday when it is not today), "in use" for a fallback
 * account, else the login's email.
 */
export function claudeAccountStatus(account: ClaudeAccountView, now: Date): string {
  if (account.limitedUntil !== null) {
    const back = new Date(account.limitedUntil);
    const sameDay = back.toDateString() === now.toDateString();
    const day = sameDay ? '' : `${back.toLocaleDateString('en-US', { weekday: 'short' })} `;
    return `at limit, back ${day}${clockLabel(back)}`;
  }
  if (account.inUse && !account.preferred) {
    return 'in use';
  }
  return account.email ?? account.configDir ?? 'default login';
}

/**
 * The footer's words: "Claude · Acme", "Claude · Personal (Acme at limit)"
 * after a fallback, "Claude · Acme at limit" when no account is free. Null
 * with fewer than two accounts: one account has nothing to choose.
 */
export function claudeAccountsFooterText(view: ClaudeAccountsView): string | null {
  if (view.accounts.length < 2) {
    return null;
  }
  const preferred = view.accounts[0];
  const inUse = view.accounts.find((account) => account.inUse);
  if (!preferred) {
    return null;
  }
  if (!inUse) {
    return `Claude · ${preferred.shortLabel} at limit`;
  }
  if (inUse.id === preferred.id) {
    return `Claude · ${inUse.shortLabel}`;
  }
  return `Claude · ${inUse.shortLabel} (${preferred.shortLabel} at limit)`;
}
