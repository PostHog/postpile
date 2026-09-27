import { ClaudeCliRunner, RunnerAgentService } from '@code-manager/agent';
import { systemTimers, UNDO_WINDOW_MS } from '@code-manager/core';
import { GhCliTokenSource, GitHubClient, GitHubWriteClient, type GitHubWriter, type TokenSource } from '@code-manager/github';
import { Store } from '@code-manager/store';
import { Engine } from './engine.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { defaultPaths, type AppPaths } from './paths.ts';
import { ReadOnlyWriter } from './read-only-writer.ts';
import type { EngineService } from './service.ts';

export interface CreateEngineOptions {
  paths?: AppPaths;
  /** No GitHub writes at all. Defaults to CODE_MANAGER_READ_ONLY=1. */
  readOnly?: boolean;
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
  const writer = makeWriter(tokens, readOnly);
  const markThreadReadLocally = (threadId: string): void => {
    store.notifications.markRead(threadId, new Date().toISOString());
  };
  return new Engine({
    store,
    reader: new GitHubClient(tokens),
    writer,
    agent: new RunnerAgentService(new ClaudeCliRunner()),
    markReadQueue: new MarkReadQueue(writer, systemTimers, UNDO_WINDOW_MS, markThreadReadLocally),
    instructionsFile: paths.instructionsFile,
    now: () => new Date(),
  });
}
