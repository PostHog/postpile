// Runs one round of one arm in a child process (`main.ts simulate-round`),
// so each arm's environment is its own: POSTPILE_TOPIC_DIGEST picks the
// agent pipeline, and the database, data folder and instructions are the
// arm's scratch files.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArmName } from './simulate-args.ts';
import type { RoundRun } from './simulate-start.ts';

const MAIN_FILE = fileURLToPath(new URL('../main.ts', import.meta.url));

/** POSTPILE_TOPIC_DIGEST per arm: the agreed switch between the old jobs and the combined per-topic call. */
const TOPIC_DIGEST: Record<ArmName, string> = { old: '0', combined: '1' };

/** The child's environment: only the arm's files, no GitHub writes, no sync, poll or telemetry. */
export function roundEnv(run: RoundRun, parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...parent,
    POSTPILE_PROFILE: 'dev',
    POSTPILE_DB: run.databaseFile,
    POSTPILE_DATA_DIR: run.armDir,
    POSTPILE_INSTRUCTIONS: run.instructionsFile,
    POSTPILE_READ_ONLY: '1',
    POSTPILE_SYNC_ON_START: '0',
    POSTPILE_POLL_SECONDS: '0',
    POSTPILE_AUTO_SYNC_MINUTES: '0',
    POSTPILE_CATCHUP_CAP: '0',
    POSTPILE_TELEMETRY: '0',
    POSTPILE_MAX_AGENT_CALLS: String(run.maxAgentCalls),
    POSTPILE_TOPIC_DIGEST: TOPIC_DIGEST[run.arm],
  };
}

export async function spawnRound(run: RoundRun): Promise<void> {
  const keysFile = join(run.armDir, `round-${run.round}-keys.json`);
  writeFileSync(keysFile, JSON.stringify(run.prKeys));
  const args = [
    // tsx's loader flags, so the child runs the TypeScript source like this process does.
    ...process.execArgv,
    MAIN_FILE,
    'simulate-round',
    '--start-at',
    run.startAt,
    '--keys',
    keysFile,
    '--max-agent-calls',
    String(run.maxAgentCalls),
    '--agent-jobs',
    run.agentJobs.join(','),
  ];
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: roundEnv(run, process.env) });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${run.arm}, round ${run.round}: the child process exited with ${code}`));
      }
    });
  });
}
