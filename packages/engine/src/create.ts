import { ClaudeCliRunner, RunnerAgentService } from '@postpile/agent';
import { systemTimers, UNDO_WINDOW_MS } from '@postpile/core';
import { GhCliTokenSource, GitHubClient, GitHubWriteClient } from '@postpile/github';
import { Store } from '@postpile/store';
import { putBackNotTaken } from './actions/local-change.ts';
import { AgentCallLog } from './agent-call-log.ts';
import { Engine } from './engine.ts';
import { PING_DECISIONS_PER_DAY } from './live/ping-decider.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { migrateLegacyData } from './legacy-data.ts';
import { defaultPaths, type AppPaths } from './paths.ts';
import type { EngineService } from './service.ts';
import { ActionLog } from './writes/action-log.ts';
import { GitHubWrites } from './writes/github-writes.ts';
import { PendingWrites } from './writes/pending-writes.ts';
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
}

/** POSTPILE_PING_CAP when it is a whole number >= 0, else the default. */
export function pingCapFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : PING_DECISIONS_PER_DAY;
}

/** Wires the real dependencies. Tests build Engine directly with fakes instead. */
export function createEngine(options: CreateEngineOptions = {}): EngineService {
  if (!options.paths) {
    // One-time move from the code-manager folders; a no-op once done.
    migrateLegacyData();
  }
  const paths = options.paths ?? defaultPaths();
  const readOnly = options.readOnly ?? process.env.POSTPILE_READ_ONLY === '1';
  const tokens = new GhCliTokenSource();
  const store = Store.open(paths.databaseFile);
  const reader = new GitHubClient(tokens);
  const now = (): Date => new Date();
  // Off until the user opens the footer lock; the choice is kept in meta.
  const writeSwitch = new WriteSwitch(store, readOnly ? null : new GitHubWriteClient(tokens));
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
    agent: new RunnerAgentService(new ClaudeCliRunner(), { observer: callLog }),
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
  });
}
