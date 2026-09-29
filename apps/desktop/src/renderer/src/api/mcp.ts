import { useQuery } from '@tanstack/react-query';
import type { McpConnectionView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/**
 * Whether Claude Code has PostPile's MCP server. Asked again when the window
 * gets focus back; the server runs `claude mcp get` at most every few
 * minutes, so this never spawns claude on every ask. "Add to Claude Code" is
 * useActions().connectMcp.
 */
export function useMcpConnection() {
  return useQuery({
    queryKey: queryKeys.mcpConnection,
    queryFn: () => request<McpConnectionView>('GET', '/api/mcp-connection'),
    refetchOnWindowFocus: true,
  });
}
