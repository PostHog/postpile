import type { AgentService } from '@postpile/agent';
import type { FactChangeCounts, PrEvent, PrKey, Viewer } from '@postpile/core';
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
  /** Told the events the events agent just raised to loud (their ping decision runs again); answers the errors. */
  onEventsRaised?: (events: PrEvent[]) => Promise<string[]>;
  /** One call per topic: dossier and first glance batch together (POSTPILE_TOPIC_DIGEST=1). Missing: off. */
  topicDigest?: boolean;
}

/** One topic for a glance catch-up run; topicId null is the virtual Unsorted topic. */
export interface TopicScope {
  topicId: string | null;
  /** Only these PRs of the topic (a glance refresh on look). Missing: every PR of the topic. */
  prKeys?: PrKey[];
}
