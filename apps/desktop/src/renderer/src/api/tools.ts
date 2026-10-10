import { useQuery } from '@tanstack/react-query';
import type { ToolsView } from '@postpile/core';
import { agentOffReason, toolsRefetchMs } from '../lib/tools.ts';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/**
 * gh and claude as the server sees them, with the fix commands. Asked often
 * while something is wrong: the server only rechecks when its backoff says
 * so, so this never runs gh or claude on every ask. "Check again" is
 * useActions().checkTools.
 */
export function useTools() {
  return useQuery({
    queryKey: queryKeys.tools,
    queryFn: () => request<ToolsView>('GET', '/api/tools'),
    refetchInterval: (query) => toolsRefetchMs(query.state.data),
  });
}

/**
 * Why agent-only controls are disabled right now (`agentOffReason`), null
 * while the agent is on. For their `disabled` and `title`. No timer of its
 * own: the "in 25 min" moves on with the tools refetch (every 30s while the
 * agent is off), which is close enough for a tooltip.
 */
export function useAgentOffReason(): string | null {
  const tools = useTools();
  return agentOffReason(tools.data, new Date());
}
