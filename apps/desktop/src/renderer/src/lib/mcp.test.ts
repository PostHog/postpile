import { describe, expect, it } from 'vitest';
import type { McpConnectionView } from '@postpile/core';
import { mcpFooterShows } from './mcp.ts';

const view: McpConnectionView = {
  state: 'not_connected',
  blockedReason: null,
  addCommand: 'claude mcp add --scope user postpile -- /Applications/PostPile.app/Contents/Resources/postpile-mcp',
  serverCommand: '/Applications/PostPile.app/Contents/Resources/postpile-mcp',
  hidden: false,
  checkedAt: '2026-09-29T10:00:00Z',
  error: null,
};

describe('mcpFooterShows', () => {
  it('asks only while Claude Code lacks the server and "Not now" was not picked', () => {
    expect(mcpFooterShows(view)).toBe(true);
    expect(mcpFooterShows({ ...view, hidden: true })).toBe(false);
    expect(mcpFooterShows({ ...view, state: 'connected' })).toBe(false);
    expect(mcpFooterShows({ ...view, state: 'unknown', blockedReason: 'Needs claude: claude not found' })).toBe(false);
    expect(mcpFooterShows(undefined)).toBe(false);
  });
});
