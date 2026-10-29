import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import type { AgentCallLog } from './agent-call-log.ts';
import type { GlancePings } from './live/glance-pings.ts';
import type { PingDecider } from './live/ping-decider.ts';
import type { RaisedPings } from './live/raised-pings.ts';
import type { FactWriter } from './memory/fact-writer.ts';
import type { PromptContextSource } from './prompt-context.ts';
import type { ScoutRun } from './scouts/scout-run.ts';
import type { ScoutedClosures } from './scouts/scouted-closures.ts';
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
  /** Pings for events the events agent raised to loud after the poll decided them; the poll hands them to the Mac. */
  raisedPings?: RaisedPings;
  /** The poll's decider: a full sync hands it its fresh new events (`keepSyncedNews`). */
  pingDecider?: PingDecider;
  /** One call per topic: dossier and first glance batch together (POSTPILE_TOPIC_DIGEST=1). Missing: off. */
  topicDigest?: boolean;
  /** The scout step of a full sync (DESIGN.md "Scouts"). Missing: no scouts.md wired, e.g. in tests. */
  scouts?: ScoutRun;
  /** Telemetry's scout_pr_closed sweep, run right after the inbox fetch, before scout expiry. Missing: none. */
  scoutClosures?: ScoutedClosures;
}

/** RunDeps.telemetry defaults to a no-op, so SyncRun and ConsolidationRun never have to branch on whether it is set. */
export function runTelemetry(deps: RunDeps): Telemetry {
  return deps.telemetry ?? new NoopTelemetry();
}
