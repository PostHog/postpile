#!/usr/bin/env -S npx tsx
// Dev CLI, the way to exercise the engine without a UI:
//   pnpm cli topics
//   POSTPILE_FAKE=1 pnpm cli topics   (Depot sample data)
import { engineFromEnv, readOwnVersion, syncCallCapFromEnv } from '@postpile/server';
import { parseInvocation, usage, withCallCap, type Command } from './args.ts';
import { formatPoll, formatPr, formatSync, formatTopic, formatTopics } from './format.ts';
import { formatConsolidation } from './format-memory.ts';
import { formatSweep } from './format-work-context.ts';
import { formatSetupDraft } from './format-setup.ts';
import { formatTools } from './format-tools.ts';
import { readFileSync } from 'node:fs';
import type { PrKey } from '@postpile/core';
import { applyLegacyEnv, runSimulatedRound, type EngineService } from '@postpile/engine';
import { runMcpFromEnv } from '@postpile/mcp';
import type { SimulateRoundOptions } from './simulate/simulate-args.ts';
import { refuseAppDataPath, simulateStart } from './simulate/simulate-start.ts';
import { spawnRound } from './simulate/spawn-round.ts';

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

/** The child of simulate-start: one arm's round on the database in POSTPILE_DB, never the app's own. */
async function simulateRound(options: SimulateRoundOptions): Promise<string> {
  const databaseFile = process.env.POSTPILE_DB;
  const instructionsFile = process.env.POSTPILE_INSTRUCTIONS;
  if (!databaseFile || !instructionsFile) {
    throw new Error('simulate-round only runs as a child of simulate-start (POSTPILE_DB and POSTPILE_INSTRUCTIONS are not set)');
  }
  refuseAppDataPath(databaseFile);
  const prKeys = JSON.parse(readFileSync(options.keysFile, 'utf8')) as PrKey[];
  const report = await runSimulatedRound({ databaseFile, instructionsFile, startAt: options.startAt, prKeys, maxAgentCalls: options.maxAgentCalls, agentJobs: options.agentJobs });
  return formatSync(report);
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
    case 'tools':
      return formatTools(await engine.checkTools());
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
    case 'mcp':
    case 'simulate-start':
    case 'simulate-round':
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
  if (command.name === 'mcp') {
    // Owns stdout for the protocol and opens its own read-only engine.
    await runMcpFromEnv(readOwnVersion());
    return;
  }
  // Both open their own scratch databases, never the dev or real one.
  if (command.name === 'simulate-start') {
    await simulateStart(command.options, spawnRound);
    return;
  }
  if (command.name === 'simulate-round') {
    console.log(await simulateRound(command.options));
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
