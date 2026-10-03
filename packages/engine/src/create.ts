import { arch, release } from 'node:os';
import { dirname, join } from 'node:path';
import { ClaudeCliRunner, RunnerAgentService } from '@postpile/agent';
import { AGENT_REQUESTS_FOLDER, systemTimers, UNDO_WINDOW_MS, type McpLauncher } from '@postpile/core';
import { GhCliTokenSource, GitHubClient, GitHubWriteClient } from '@postpile/github';
import { Store } from '@postpile/store';
import { putBackNotTaken } from './actions/local-change.ts';
import { AgentCallLog } from './agent-call-log.ts';
import { CATCH_UP_CALLS_PER_DAY } from './catch-up/catch-up-cap.ts';
import { DataDirLock, type LockKind } from './data-lock.ts';
import { Engine } from './engine.ts';
import { PING_DECISIONS_PER_DAY } from './live/ping-decider.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { agentCwdFor, defaultPaths, seedDevInstructions, type AppPaths } from './paths.ts';
import type { EngineService } from './service.ts';
import { ActionLog } from './writes/action-log.ts';
import { GitHubWrites } from './writes/github-writes.ts';
import { PendingWrites } from './writes/pending-writes.ts';
import { systemCommands } from './setup/setup-checks.ts';
import { GitHubQuota, quotaFetch } from './github-quota.ts';
import { GatedRunner } from './tools/gated-runner.ts';
import { ToolHealth } from './tools/tool-health.ts';
import { WatchedTokenSource, watchedFetch } from './tools/watched-github.ts';
import { telemetryFromEnv, type Telemetry } from './telemetry/telemetry.ts';
import { UserConfigFile } from './user-config.ts';
import { WriteSwitch } from './writes/write-switch.ts';

export interface CreateEngineOptions {
  paths?: AppPaths;
  /**
   * No GitHub writes at all, whatever the footer lock says: the real write
   * client is never built. Defaults to POSTPILE_READ_ONLY=1.
   */
  readOnly?: boolean;
  /** Daily cap on ping decisions. Defaults to POSTPILE_PING_CAP, else PING_DECISIONS_PER_DAY. */
  pingDecisionsPerDay?: number;
  /** Who takes the database folder's lock (postpile.lock). Defaults to server. */
  lockKind?: LockKind;
  /**
   * Read the database without taking the lock, e.g. the CLI's read commands
   * while the app runs. Forces readOnly: no GitHub writes. Callers must not
   * sync or write through it.
   */
  withoutLock?: boolean;
  /** The running app's version, for telemetry's app_version property. Defaults to 'unknown'. */
  appVersion?: string;
  /** Reuse an existing Telemetry (e.g. one a main process also uses directly); defaults to building one from env. */
  telemetry?: Telemetry;
  /** How Claude Code starts the MCP server; only the desktop app knows. Missing: "Add to Claude Code" only shows the command. */
  mcpLauncher?: McpLauncher | null;
  /** The engine's clock. Defaults to the system clock; `pnpm cli simulate-start` runs the engine at a simulated time. */
  now?: () => Date;
}

/** POSTPILE_PING_CAP when it is a whole number >= 0, else the default. */
export function pingCapFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : PING_DECISIONS_PER_DAY;
}

/**
 * POSTPILE_CATCHUP_CAP when it is a whole number >= 0, else the default. A
 * dev session with POSTPILE_MAX_AGENT_CALLS=0 gets 0 too (catch-up off), so
 * "no agent calls" keeps meaning none.
 */
export function catchUpCapFromEnv(value: string | undefined, maxAgentCalls: string | undefined): number {
  const parsed = Number(value);
  if (value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return maxAgentCalls?.trim() === '0' ? 0 : CATCH_UP_CALLS_PER_DAY;
}

/**
 * Wires the real dependencies and returns the Engine itself. Only the
 * simulation (simulation/round.ts) needs its dev-only methods
 * (digestStored); everything else goes through createEngine. Not exported
 * from the package.
 */
export function wireEngine(options: CreateEngineOptions = {}): Engine {
  if (!options.paths) {
    const seeded = seedDevInstructions();
    if (seeded) {
      console.log(`PostPile dev profile: copied your instructions to ${seeded}`);
    }
  }
  const paths = options.paths ?? defaultPaths();
  const readOnly = options.withoutLock === true || (options.readOnly ?? process.env.POSTPILE_READ_ONLY === '1');
  // Before the store opens: a second process on the same database refuses here.
  const lock = options.withoutLock ? null : DataDirLock.acquire(paths.databaseFile, options.lockKind ?? 'server', undefined, options.appVersion);
  const now = options.now ?? ((): Date => new Date());
  const telemetry =
    options.telemetry ??
    telemetryFromEnv({
      env: process.env,
      appVersion: options.appVersion ?? 'unknown',
      osVersion: release(),
      arch: arch(),
      telemetryIdFile: paths.telemetryIdFile,
    });
  // gh and claude behind one status: a missing or logged-out tool stops the
  // calls that need it (no process per call, no log line per call) and the UI
  // shows the fix. Real failures report back into it.
  // Every gh and claude process runs in the app's own empty folder.
  const agentCwd = agentCwdFor(paths.databaseFile);
  const commands = systemCommands(agentCwd);
  const ghTokens = new GhCliTokenSource(agentCwd);
  const tools = new ToolHealth({ commands,
    now,
    forgetToken: () => ghTokens.forget(),
    onBroken: (tool, reason) => telemetry.capture('tool_missing', { tool, reason }),
  });
  const tokens = new WatchedTokenSource(ghTokens, tools);
  // The hourly GitHub quota is shared with the user's own gh: every answer's
  // rate-limit headers land here, and background work leaves headroom.
  const quota = new GitHubQuota(
    () => Date.now(),
    (resource, level) => telemetry.capture('github_quota_low', { resource, level }),
  );
  const fetchFn = watchedFetch(tools, quotaFetch(quota));
  let store: Store;
  try {
    // Without the lock the app may be writing: open read-only, no migrations, no WAL pragma.
    store = options.withoutLock ? Store.openReadOnly(paths.databaseFile) : Store.open(paths.databaseFile);
  } catch (error) {
    lock?.release();
    throw error;
  }
  const reader = new GitHubClient(tokens, fetchFn);
  // Off until the user opens the footer lock; the choice is kept in meta.
  const writeSwitch = new WriteSwitch(store, readOnly ? null : new GitHubWriteClient(tokens, fetchFn));
  const writes = new GitHubWrites(writeSwitch, new ActionLog(store, now));
  const markThreadReadLocally = (threadId: string, readAt: string): void => {
    store.notifications.markRead(threadId, readAt);
  };
  const pendingWrites = new PendingWrites(store, writes, now);
  const callLog = new AgentCallLog(store, now);
  return new Engine({
    store,
    reader,
    writes,
    agent: new RunnerAgentService(new GatedRunner(new ClaudeCliRunner({ cwd: agentCwd }), tools), { observer: callLog }),
    callLog,
    markReadQueue: new MarkReadQueue(
      writes,
      reader,
      systemTimers,
      UNDO_WINDOW_MS,
      markThreadReadLocally,
      (batch) => pendingWrites.park(batch),
      (thread, local) => putBackNotTaken(store, thread, local),
    ),
    pendingWrites,
    instructionsFile: paths.instructionsFile,
    storeReadOnly: options.withoutLock === true,
    now,
    pingDecisionsPerDay: options.pingDecisionsPerDay ?? pingCapFromEnv(process.env.POSTPILE_PING_CAP),
    catchUpCallsPerDay: catchUpCapFromEnv(process.env.POSTPILE_CATCHUP_CAP, process.env.POSTPILE_MAX_AGENT_CALLS),
    topicDigest: process.env.POSTPILE_TOPIC_DIGEST === '1',
    dataLock: lock,
    userConfig: paths.configFile ? new UserConfigFile(paths.configFile) : null,
    setupCommands: commands,
    mcpLauncher: options.mcpLauncher ?? null,
    tools,
    telemetry,
    appVersion: options.appVersion,
    quota,
    // Only the lock holder answers agent requests; read-only access never does.
    agentRequestsFolder: lock ? join(dirname(paths.databaseFile), AGENT_REQUESTS_FOLDER) : null,
    // The app's start sync asks the inbox catch-up dialog first; the CLI has no window to ask in.
    catchUpGate: lock !== null && (options.lockKind ?? 'server') !== 'cli',
  });
}

/** Wires the real dependencies. Tests build Engine directly with fakes instead. */
export function createEngine(options: CreateEngineOptions = {}): EngineService {
  return wireEngine(options);
}
