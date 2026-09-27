import { ClaudeCliRunner, RunnerAgentService } from '@code-manager/agent';
import { GhCliTokenSource, GitHubClient, GitHubWriteClient } from '@code-manager/github';
import { Store } from '@code-manager/store';
import { Engine } from './engine.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { defaultPaths, type AppPaths } from './paths.ts';
import type { EngineService } from './service.ts';

const realTimers = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
};

/** Wires the real dependencies. Tests build Engine directly with fakes instead. */
export function createEngine(paths: AppPaths = defaultPaths()): EngineService {
  const tokens = new GhCliTokenSource();
  const writer = new GitHubWriteClient(tokens);
  return new Engine({
    store: Store.open(paths.databaseFile),
    reader: new GitHubClient(tokens),
    writer,
    agent: new RunnerAgentService(new ClaudeCliRunner()),
    markReadQueue: new MarkReadQueue(writer, realTimers),
    instructionsFile: paths.instructionsFile,
    now: () => new Date(),
  });
}
