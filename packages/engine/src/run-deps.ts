import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import type { AgentCallLog } from './agent-call-log.ts';
import type { FactWriter } from './memory/fact-writer.ts';
import type { PromptContextSource } from './prompt-context.ts';

/** What a sync run and a consolidation run both need. */
export interface RunDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  callLog: AgentCallLog;
  facts: FactWriter;
  now: () => Date;
}
