import { AGENT_REQUEST_VERSION, type AgentRequest, type AgentRequestResult } from '@postpile/core';
import type { EngineService } from '../service.ts';

/**
 * Hands one checked agent request to the engine and wraps its answer. The
 * app's inbox calls it for each request file; the MCP server over sample
 * data calls it directly, in memory.
 */
export async function answerAgentRequest(service: Pick<EngineService, 'refreshNow' | 'proposeTopicChange' | 'notePr'>, request: AgentRequest): Promise<AgentRequestResult> {
  if (request.kind === 'refresh') {
    const refresh = await service.refreshNow(request.payload, { source: 'agent', client: request.client });
    return { v: AGENT_REQUEST_VERSION, ok: true, kind: 'refresh', refresh };
  }
  if (request.kind === 'note_pr') {
    const prNote = await service.notePr(request.payload, { client: request.client });
    return { v: AGENT_REQUEST_VERSION, ok: true, kind: 'note_pr', prNote };
  }
  const topicChange = await service.proposeTopicChange(request.payload, { client: request.client });
  return { v: AGENT_REQUEST_VERSION, ok: true, kind: 'propose_topic_change', topicChange };
}
