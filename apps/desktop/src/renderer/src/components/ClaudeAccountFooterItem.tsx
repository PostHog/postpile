import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaudeAccountView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useClaudeAccounts } from '../api/claude-accounts.ts';
import { claudeAccountsFooterText, claudeAccountStatus } from '../lib/claude-accounts.ts';
import { holdMenuOpen } from '../lib/open-menus.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { CheckIcon } from './icons.tsx';

/** One account: a check on the preferred one, its name and a quiet status word. */
function AccountItem(props: { account: ClaudeAccountView; now: Date; onPick: () => void }) {
  const { account } = props;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={account.preferred}
      title={account.configDir ? `Claude config folder ${account.configDir}` : 'The default Claude login (CLAUDE_CONFIG_DIR not set)'}
      onClick={props.onPick}
      className={`flex items-start gap-2 rounded-md p-2 text-left ${account.preferred ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
    >
      <span className="mt-0.5 w-3.5 shrink-0 text-accent">{account.preferred && <CheckIcon />}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-ink">{account.label}</span>
        <span className="truncate text-[11px] leading-[1.4] text-hint">{claudeAccountStatus(account, props.now)}</span>
      </span>
    </button>
  );
}

/**
 * "Claude · Acme" in the status footer: the Claude account agent calls run
 * on, and after a fallback which one is at its limit. Only with two or more
 * logged-in accounts. A click opens a menu with the accounts in order (a
 * pick makes it the preferred one) and the fallback switch. Opening it looks
 * for accounts again. Quiet on purpose: muted words, no warning colour.
 */
export function ClaudeAccountFooterItem() {
  const actions = useActions();
  const view = useClaudeAccounts().data;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  // The open-read dwell waits while a menu is open, like the shared Menu.
  useEffect(() => (open ? holdMenuOpen() : undefined), [open]);

  const text = view ? claudeAccountsFooterText(view) : null;
  if (!view || text === null) {
    return null;
  }

  function toggle() {
    if (!open) {
      void actions.refreshClaudeAccounts();
    }
    setOpen(!open);
  }

  function pick(account: ClaudeAccountView) {
    setOpen(false);
    if (!account.preferred) {
      void actions.preferClaudeAccount(account.id);
    }
  }

  const now = new Date();
  const busy = actions.isBusy('claude-accounts');
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="The Claude account agent calls run on. Click to pick the preferred one."
        onClick={toggle}
        className="rounded px-1 text-muted hover:bg-subtle hover:text-ink"
      >
        {text}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Claude account"
          className="absolute bottom-full left-0 z-30 mb-1.5 flex w-72 flex-col gap-0.5 rounded-row bg-surface p-1.5 font-sans whitespace-normal shadow-menu"
        >
          <span className="px-2 pt-1 pb-1.5 text-[11px] text-hint">Agent calls use the checked account first.</span>
          {view.accounts.map((account) => (
            <AccountItem key={account.id} account={account} now={now} onPick={() => pick(account)} />
          ))}
          <div aria-hidden="true" className="mx-0.5 my-1 h-px bg-hairline-soft" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={view.fallback}
            disabled={busy}
            onClick={() => void actions.setClaudeFallback(!view.fallback)}
            className="flex items-start gap-2 rounded-md p-2 text-left text-[11.5px] text-ink-2 hover:bg-subtle disabled:opacity-50"
          >
            <span className="mt-0.5 w-3.5 shrink-0 text-accent">{view.fallback && <CheckIcon />}</span>
            When it hits its limit, use the next account
          </button>
        </div>
      )}
    </div>
  );
}
