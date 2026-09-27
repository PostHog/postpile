import type { AgentCallKind } from '@code-manager/core';

/** What a call is for. Used for cache keys, logging, cost accounting and picking a model. */
export type AgentPurpose = AgentCallKind;

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

/** One finished call, success or not, as the service saw it. */
export interface ObservedCall {
  purpose: AgentPurpose;
  model: string;
  /** False when the runner failed or the answer did not parse. */
  ok: boolean;
  topicId: string | null;
  attempt: number;
  durationMs: number;
  costUsd: number | null;
}

/**
 * Told about every call RunnerAgentService makes. The engine uses it for the
 * per-kind stats in the sync report and the agent_call table.
 */
export interface AgentCallObserver {
  onCall(call: ObservedCall): void;
}
