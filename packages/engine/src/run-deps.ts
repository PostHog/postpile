import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import type { AgentCallLog } from './agent-call-log.ts';
import type { GlancePings } from './live/glance-pings.ts';
import type { FactWriter } from './memory/fact-writer.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { NoopTelemetry, type Telemetry } from './telemetry/telemetry.ts';

/** What a sync run and a consolidation run both need. */
export interface RunDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  callLog: AgentCallLog;
  facts: FactWriter;
  now: () => Date;
  /** The claude headline while the agent is off, else null. Runs skip their agent jobs then. */
  agentOff: () => string | null;
  /** Optional so existing test fixtures keep compiling; runTelemetry() below is what call sites use. */
  telemetry?: Telemetry;
  /** Look closer pings on routed reviews, told after glances are stored; the poll hands them to the Mac. */
  glancePings?: GlancePings;
}

/** RunDeps.telemetry defaults to a no-op, so SyncRun and ConsolidationRun never have to branch on whether it is set. */
export function runTelemetry(deps: RunDeps): Telemetry {
  return deps.telemetry ?? new NoopTelemetry();
}
