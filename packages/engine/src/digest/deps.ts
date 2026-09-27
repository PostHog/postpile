import type { AgentService } from '@code-manager/agent';
import type { FactChangeCounts, Viewer } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { AgentBudget } from '../budget.ts';
import type { FactWriter } from '../memory/fact-writer.ts';
import type { PromptContextSource } from '../prompt-context.ts';

/** What a sync's digest adds to the report besides errors and call stats. */
export interface DigestTally {
  dossiersUpdated: number;
  facts: FactChangeCounts;
}

/** What every digest job needs. errors collects per-call failures; one bad answer never stops a sync. */
export interface DigestDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  budget: AgentBudget;
  facts: FactWriter;
  viewer: Viewer;
  errors: string[];
  tally: DigestTally;
  now: () => Date;
}
