import type { AgentRequest, AgentResponse, AgentRunner } from '@postpile/agent';
import { errorText } from '../errors.ts';
import type { ClaudeAccounts } from './claude-accounts.ts';

/** Starts one claude process on an account: a config folder, null for the default, undefined for the app's own environment. */
export type SpawnOn = (configDir: string | null | undefined) => Promise<AgentResponse>;

/** The claude runner as this needs it (ClaudeCliRunner): a concurrency slot in which `task` starts claude on accounts. */
export interface SlotRunner {
  runInSlot(request: AgentRequest, task: (spawnOn: SpawnOn) => Promise<AgentResponse>): Promise<AgentResponse>;
}

/**
 * Runs each call on the first Claude account that is not at its usage limit.
 * The account is picked once the call has its slot, so calls that waited
 * see limits found meanwhile. A call that hits the limit marks its account
 * and goes again on the next one at once, in the same slot. Only when no
 * account is left does the limit reach the GatedRunner around this, which
 * pauses the agent until the soonest reset.
 */
export class ClaudeAccountRunner implements AgentRunner {
  constructor(
    private readonly cli: SlotRunner,
    private readonly accounts: ClaudeAccounts,
  ) {}

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

  private async runOnAccounts(spawnOn: SpawnOn): Promise<AgentResponse> {
    let lastLimit: unknown = null;
    // Ends: every limit marks one more account, and pick() skips marked ones.
    for (;;) {
      const id = this.accounts.pick();
      if (id === null) {
        throw this.allLimitedError(lastLimit);
      }
      try {
        const response = await spawnOn(this.accounts.configDirOf(id));
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

  async run(request: AgentRequest): Promise<AgentResponse> {
    await this.accounts.ensureDiscovered();
    return this.cli.runInSlot(request, (spawnOn) => this.runOnAccounts(spawnOn));
  }
}
