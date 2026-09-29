import { ClaudeCliRunner, RunnerAgentService } from '@postpile/agent';
import { systemTimers, UNDO_WINDOW_MS } from '@postpile/core';
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
import { GatedRunner } from './tools/gated-runner.ts';
import { ToolHealth } from './tools/tool-health.ts';
import { WatchedTokenSource, watchedFetch } from './tools/watched-github.ts';
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

/** Wires the real dependencies. Tests build Engine directly with fakes instead. */
export function createEngine(options: CreateEngineOptions = {}): EngineService {
  if (!options.paths) {
    const seeded = seedDevInstructions();
    if (seeded) {
      console.log(`PostPile dev profile: copied your instructions to ${seeded}`);
    }
  }
  const paths = options.paths ?? defaultPaths();
  const readOnly = options.withoutLock === true || (options.readOnly ?? process.env.POSTPILE_READ_ONLY === '1');
  // Before the store opens: a second process on the same database refuses here.
  const lock = options.withoutLock ? null : DataDirLock.acquire(paths.databaseFile, options.lockKind ?? 'server');
  const now = (): Date => new Date();
  // gh and claude behind one status: a missing or logged-out tool stops the
  // calls that need it (no process per call, no log line per call) and the UI
  // shows the fix. Real failures report back into it.
  // Every gh and claude process runs in the app's own empty folder.
  const agentCwd = agentCwdFor(paths.databaseFile);
  const commands = systemCommands(agentCwd);
  const ghTokens = new GhCliTokenSource(agentCwd);
  const tools = new ToolHealth({ commands, now, forgetToken: () => ghTokens.forget() });
  const tokens = new WatchedTokenSource(ghTokens, tools);
  const fetchFn = watchedFetch(tools);
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
    now,
    pingDecisionsPerDay: options.pingDecisionsPerDay ?? pingCapFromEnv(process.env.POSTPILE_PING_CAP),
    catchUpCallsPerDay: catchUpCapFromEnv(process.env.POSTPILE_CATCHUP_CAP, process.env.POSTPILE_MAX_AGENT_CALLS),
    dataLock: lock,
    userConfig: paths.configFile ? new UserConfigFile(paths.configFile) : null,
    setupCommands: commands,
    tools,
  });
}
