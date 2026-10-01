// Dev only (`pnpm cli simulate-start`): one round of one arm, the digest a
// sync would run after fetching the round's PRs. The CLI runs it in a child
// process per arm and round, so each arm gets its own environment
// (POSTPILE_TOPIC_DIGEST); tests call it directly.
import type { AgentJob, IsoTime, PrKey, SyncReport } from '@postpile/core';
import { createEngine } from '../create.ts';

export interface SimulatedRoundOptions {
  databaseFile: string;
  instructionsFile: string;
  /** Simulated time the round starts at; the engine's clock runs on from it. */
  startAt: IsoTime;
  prKeys: PrKey[];
  maxAgentCalls: number;
  agentJobs: AgentJob[];
}

/** A clock that starts at `startAt` and moves with real time, so call durations and order stay real. */
export function simulatedClock(startAt: IsoTime): () => Date {
  const realStart = Date.now();
  const simulatedStart = new Date(startAt).getTime();
  return () => new Date(simulatedStart + (Date.now() - realStart));
}

/** Opens the arm's database with the real agent, never with GitHub writes, runs the stored digest and closes. */
export async function runSimulatedRound(options: SimulatedRoundOptions): Promise<SyncReport> {
  const engine = createEngine({
    paths: { databaseFile: options.databaseFile, instructionsFile: options.instructionsFile },
    readOnly: true,
    lockKind: 'cli',
    now: simulatedClock(options.startAt),
  });
  try {
    return await engine.digestStored({ prKeys: options.prKeys, maxAgentCalls: options.maxAgentCalls, agentJobs: options.agentJobs });
  } finally {
    await engine.close();
  }
}
