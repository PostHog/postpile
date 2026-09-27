import type { AgentService } from '@code-manager/agent';
import type { Viewer } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { AgentBudget } from '../budget.ts';
import type { PromptContextSource } from '../prompt-context.ts';

/** What every digest job needs. errors collects per-call failures; one bad answer never stops a sync. */
export interface DigestDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  budget: AgentBudget;
  viewer: Viewer;
  errors: string[];
  now: () => Date;
}
