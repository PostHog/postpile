#!/usr/bin/env -S npx tsx
// Dev CLI, the way to exercise the engine without a UI:
//   npm run cli -- topics
//   CODE_MANAGER_FAKE=1 npm run cli -- topics   (Depot sample data)
import { engineFromEnv } from '@postpile/server';
import { parseArgs, usage, type Command } from './args.ts';
import { formatPoll, formatPr, formatSync, formatTopic, formatTopics } from './format.ts';
import { formatConsolidation } from './format-memory.ts';
import { formatSweep } from './format-work-context.ts';
import type { EngineService } from '@postpile/engine';

async function runCommand(engine: EngineService, command: Command): Promise<string> {
  switch (command.name) {
    case 'sync':
      return formatSync(await engine.sync(command.options));
    case 'consolidate':
      return formatConsolidation(await engine.consolidate(command.options));
    case 'poll':
      return formatPoll(await engine.pollOnce());
    case 'sweep': {
      const result = await engine.sweepWorkContext();
      return formatSweep(result, await engine.getWorkContext());
    }
    case 'topics':
      return formatTopics(await engine.listTopics());
    case 'topic': {
      const detail = await engine.getTopic(command.topicId);
      return detail ? formatTopic(detail) : `no topic ${command.topicId}`;
    }
    case 'pr': {
      const detail = await engine.getPr(command.prKey);
      return detail ? formatPr(detail) : `no PR ${command.prKey} in the store`;
    }
    case 'help':
      return usage;
  }
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  if (command.name === 'help') {
    console.log(usage);
    return;
  }
  const engine = engineFromEnv();
  try {
    console.log(await runCommand(engine, command));
    // The CLI never holds a mark-read in an undo window, but flush in case an action queued one.
    await engine.flushPendingWrites();
  } finally {
    await engine.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
