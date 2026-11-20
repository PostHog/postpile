import { useQuery } from '@tanstack/react-query';
import type { ClaudeAccountsView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/**
 * The logged-in Claude accounts in call order, which one calls run on and
 * which are at their limit. Answered from the server's memory, so asking
 * every minute spawns nothing; opening the footer menu looks for accounts
 * again (useActions().refreshClaudeAccounts).
 */
export function useClaudeAccounts() {
  return useQuery({
    queryKey: queryKeys.claudeAccounts,
    queryFn: () => request<ClaudeAccountsView>('GET', '/api/claude-accounts'),
    refetchInterval: 60_000,
  });
}
