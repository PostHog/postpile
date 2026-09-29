import type { McpConnectionView } from '@postpile/core';

/**
 * The footer asks only when claude answered that Claude Code lacks the
 * server and the user did not say "Not now". Unknown (a dev build, claude
 * missing or logged out, a failed check) never nags: the tool note covers claude.
 */
export function mcpFooterShows(view: McpConnectionView | undefined): boolean {
  return view !== undefined && view.state === 'not_connected' && !view.hidden;
}
