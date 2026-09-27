import type { AgentPurpose, AgentRequest, AgentResponse, AgentRunner } from './runner.ts';

/**
 * Test double for AgentRunner. Answers are queued per purpose and handed out
 * in order; every request is recorded so tests can check the prompt.
 */
export class FakeRunner implements AgentRunner {
  readonly requests: AgentRequest[] = [];
  private readonly answers = new Map<AgentPurpose, string[]>();

  /** Queue an answer. Objects are JSON-encoded, strings are returned as-is. */
  answer(purpose: AgentPurpose, answer: unknown): this {
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
    const queue = this.answers.get(purpose) ?? [];
    queue.push(text);
    this.answers.set(purpose, queue);
    return this;
  }

  run(request: AgentRequest): Promise<AgentResponse> {
    this.requests.push(request);
    const text = this.answers.get(request.purpose)?.shift();
    if (text === undefined) {
      return Promise.reject(new Error(`FakeRunner has no answer queued for ${request.purpose}`));
    }
    return Promise.resolve({ text, model: request.model, durationMs: 0, costUsd: null });
  }

  promptsFor(purpose: AgentPurpose): string[] {
    return this.requests.filter((r) => r.purpose === purpose).map((r) => r.prompt);
  }
}
