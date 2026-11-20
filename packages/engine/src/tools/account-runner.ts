import type { AgentRequest, AgentResponse, AgentRunner } from '@postpile/agent';
import { errorText } from '../errors.ts';
import type { ClaudeAccounts } from './claude-accounts.ts';

/** The claude runner as this needs it: one call with a given CLAUDE_CONFIG_DIR (ClaudeCliRunner). */
export interface ConfigDirRunner {
  run(request: AgentRequest): Promise<AgentResponse>;
  runWithConfigDir(request: AgentRequest, configDir: string | null): Promise<AgentResponse>;
}

/**
 * Runs each call on the first Claude account that is not at its usage limit.
 * A call that hits the limit marks its account and goes again on the next
 * one at once. Only when no account is left does the limit reach the
 * GatedRunner around this, which pauses the agent until the soonest reset.
 */
export class ClaudeAccountRunner implements AgentRunner {
  constructor(
    private readonly cli: ConfigDirRunner,
    private readonly accounts: ClaudeAccounts,
  ) {}

  private callOn(id: string, request: AgentRequest): Promise<AgentResponse> {
    const configDir = this.accounts.configDirOf(id);
    return configDir === undefined ? this.cli.run(request) : this.cli.runWithConfigDir(request, configDir);
  }

  /**
   * Worded so claudeFailure reads it as a limit with the soonest reset
   * ("limit reached|<epoch seconds>"), plus the last real answer for the log.
   */
  private allLimitedError(last: unknown): Error {
    const soonest = this.accounts.soonestFreeMs();
    const reset = soonest === null ? 'Claude AI usage limit reached' : `Claude AI usage limit reached|${Math.floor(soonest / 1000)}`;
    const lastText = last === null ? '' : ` · last answer: ${errorText(last).slice(0, 300)}`;
    return new Error(`${reset} (no Claude account left under its limit)${lastText}`);
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    await this.accounts.ensureDiscovered();
    let lastLimit: unknown = null;
    // Ends: every limit marks one more account, and pick() skips marked ones.
    for (;;) {
      const id = this.accounts.pick();
      if (id === null) {
        throw this.allLimitedError(lastLimit);
      }
      try {
        const response = await this.callOn(id, request);
        this.accounts.noteWorked(id);
        return response;
      } catch (error) {
        if (!this.accounts.noteFailure(id, errorText(error))) {
          throw error;
        }
        lastLimit = error;
      }
    }
  }
}
