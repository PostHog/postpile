import type { AgentRequest, AgentResponse, AgentRunner } from '@postpile/agent';
import { errorText } from '../errors.ts';
import type { ToolHealth } from './tool-health.ts';

/**
 * The agent is off (claude missing, logged out or at its usage limit). The
 * message is the status headline, which starts with AGENT_OFF_MARK, so sync
 * reports can fold these into one line instead of one error per call.
 */
export class AgentOffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOffError';
  }
}

/**
 * Wraps the claude runner with the tool status: while the agent is off a call
 * fails at once without starting a process, and a failure that says
 * something about claude (not found, not logged in, usage limit) turns the
 * agent off for everyone. Callers already fall back to rules on a failed call.
 */
export class GatedRunner implements AgentRunner {
  constructor(
    private readonly inner: AgentRunner,
    private readonly health: ToolHealth,
  ) {}

  async run(request: AgentRequest): Promise<AgentResponse> {
    const off = this.health.agentOffReason();
    if (off !== null) {
      this.health.recheckIfDue();
      throw new AgentOffError(off);
    }
    try {
      const response = await this.inner.run(request);
      this.health.noteClaudeWorked();
      return response;
    } catch (error) {
      if (this.health.noteClaudeFailure(errorText(error)) !== null) {
        throw new AgentOffError(this.health.agentOffReason() ?? errorText(error));
      }
      throw error;
    }
  }
}
