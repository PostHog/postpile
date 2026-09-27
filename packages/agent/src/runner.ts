/** What a call is for. Used for cache keys, logging and picking a model. */
export type AgentPurpose =
  | 'glance'
  | 'topic_assignment'
  | 'set_grouping'
  | 'topic_summary'
  | 'event_classification'
  | 'draft_comment'
  | 'chat';

export interface AgentRequest {
  purpose: AgentPurpose;
  model: string;
  prompt: string;
  timeoutMs: number;
}

export interface AgentResponse {
  text: string;
  model: string;
  durationMs: number;
  /** Reported by the backend when it knows. */
  costUsd: number | null;
}

/**
 * The single seam every agent call goes through. Today: the local `claude`
 * CLI. Later: the Anthropic API. Tests use a fake that returns canned text.
 */
export interface AgentRunner {
  run(request: AgentRequest): Promise<AgentResponse>;
}
