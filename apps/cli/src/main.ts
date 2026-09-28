#!/usr/bin/env -S npx tsx
// Dev CLI, the way to exercise the engine without a UI:
//   pnpm cli topics
//   POSTPILE_FAKE=1 pnpm cli topics   (Depot sample data)
import { engineFromEnv, syncCallCapFromEnv } from '@postpile/server';
import { parseInvocation, usage, withCallCap, type Command } from './args.ts';
import { formatPoll, formatPr, formatSync, formatTopic, formatTopics } from './format.ts';
import { formatConsolidation } from './format-memory.ts';
import { formatSweep } from './format-work-context.ts';
import { formatSetupDraft } from './format-setup.ts';
import { applyLegacyEnv, type EngineService } from '@postpile/engine';

applyLegacyEnv();

const SETUP_POLL_MS = 500;

/** The setup checks, then the sweep and its draft once the job finished. Writes the viewer like a sync, never instructions. */
async function setupDraft(engine: EngineService): Promise<string> {
  const checks = await engine.setupChecks();
  if (!checks.canContinue) {
    return formatSetupDraft(checks, null);
  }
  let sweep = await engine.startSetupSweep();
  while (sweep.running) {
    await new Promise((resolve) => setTimeout(resolve, SETUP_POLL_MS));
    sweep = (await engine.setupSweep()) ?? sweep;
  }
  return formatSetupDraft(checks, sweep);
}

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
    case 'setup-draft':
      return setupDraft(engine);
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
  const { command, readOnly, error } = parseInvocation(process.argv.slice(2));
  if (error) {
    throw new Error(error);
  }
  if (command.name === 'help') {
    console.log(usage);
    return;
  }
  // Refuses (DataDirLockedError, exit 1) while the app or a server holds the database, unless --read-only.
  const engine = engineFromEnv({ lockKind: 'cli', withoutLock: readOnly });
  try {
    console.log(await runCommand(engine, withCallCap(command, syncCallCapFromEnv(process.env.POSTPILE_MAX_AGENT_CALLS))));
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
