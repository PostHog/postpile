import type { AgentService } from '@postpile/agent';
import type { FactChangeCounts, PrKey, Viewer } from '@postpile/core';
import type { Store } from '@postpile/store';
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
  /** Told the PRs whose glance was just stored (the Look closer ping on routed reviews). */
  onGlancesStored?: (prKeys: PrKey[]) => void;
}

/** One topic for a glance catch-up run; topicId null is the virtual Unsorted topic. */
export interface TopicScope {
  topicId: string | null;
}
