import { ClaudeCliRunner, RunnerAgentService } from '@code-manager/agent';
import { systemTimers, UNDO_WINDOW_MS } from '@code-manager/core';
import { GhCliTokenSource, GitHubClient, GitHubWriteClient, type GitHubWriter, type TokenSource } from '@code-manager/github';
import { Store } from '@code-manager/store';
import { AgentCallLog } from './agent-call-log.ts';
import { Engine } from './engine.ts';
import { PING_DECISIONS_PER_DAY } from './live/ping-decider.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { defaultPaths, type AppPaths } from './paths.ts';
import { ReadOnlyWriter } from './read-only-writer.ts';
import type { EngineService } from './service.ts';

export interface CreateEngineOptions {
  paths?: AppPaths;
  /** No GitHub writes at all. Defaults to CODE_MANAGER_READ_ONLY=1. */
  readOnly?: boolean;
  /** Daily cap on ping decisions. Defaults to CODE_MANAGER_PING_CAP, else PING_DECISIONS_PER_DAY. */
  pingDecisionsPerDay?: number;
}

/** CODE_MANAGER_PING_CAP when it is a whole number >= 0, else the default. */
export function pingCapFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : PING_DECISIONS_PER_DAY;
}

function makeWriter(tokens: TokenSource, readOnly: boolean): GitHubWriter {
  return readOnly ? new ReadOnlyWriter() : new GitHubWriteClient(tokens);
}

/** Wires the real dependencies. Tests build Engine directly with fakes instead. */
export function createEngine(options: CreateEngineOptions = {}): EngineService {
  const paths = options.paths ?? defaultPaths();
  const readOnly = options.readOnly ?? process.env.CODE_MANAGER_READ_ONLY === '1';
  const tokens = new GhCliTokenSource();
  const store = Store.open(paths.databaseFile);
  const reader = new GitHubClient(tokens);
  const writer = makeWriter(tokens, readOnly);
  const markThreadReadLocally = (threadId: string, readAt: string): void => {
    store.notifications.markRead(threadId, readAt);
  };
  const now = (): Date => new Date();
  const callLog = new AgentCallLog(store, now);
  return new Engine({
    store,
    reader,
    writer,
    agent: new RunnerAgentService(new ClaudeCliRunner(), { observer: callLog }),
    callLog,
    markReadQueue: new MarkReadQueue(writer, reader, systemTimers, UNDO_WINDOW_MS, markThreadReadLocally),
    instructionsFile: paths.instructionsFile,
    now,
    pingDecisionsPerDay: options.pingDecisionsPerDay ?? pingCapFromEnv(process.env.CODE_MANAGER_PING_CAP),
  });
}
