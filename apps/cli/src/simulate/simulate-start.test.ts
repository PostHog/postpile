import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeThreadFor } from '@postpile/core/fixtures';
import { runSimulatedRound } from '@postpile/engine';
import { makeHarness } from '@postpile/engine/testing';
import { reviewRequestedPr } from '@postpile/engine/testing/prs';
import { Store } from '@postpile/store';
import type { SimulateStartOptions } from './simulate-args.ts';
import { simulateStart, type RoundRun } from './simulate-start.ts';
import { roundEnv } from './spawn-round.ts';

const PRS = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-simulate-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** An invented database that synced once: three PRs with threads, glances and a topic from the fake agent. */
async function sourceDatabase(): Promise<string> {
  const file = join(dir, 'source.sqlite');
  const h = makeHarness({ store: Store.open(file) });
  for (const pr of PRS) {
    h.reader.addPr(pr, makeThreadFor(pr));
  }
  await h.engine.sync({ agentJobs: ['glances'] });
  h.store.close();
  return file;
}

function options(from: string): SimulateStartOptions {
  return { from, days: 7, roundSize: 2, out: join(dir, 'out'), arms: ['old', 'combined'], maxAgentCalls: 1000, rounds: null, dryRun: true, now: null };
}

describe('simulateStart', () => {
  it('runs every round on each arm from the same fresh start, without agent calls in a dry run', async () => {
    const from = await sourceDatabase();
    const before = fileHash(from);
    const runs: RoundRun[] = [];
    // Stands in for the leader's topics job: the follower must get this topic before its own run.
    const runRound = async (run: RoundRun): Promise<void> => {
      runs.push(run);
      await runSimulatedRound(run);
      if (run.arm === 'old') {
        const store = Store.open(run.databaseFile);
        if (store.topics.get('ci') === null) {
          store.topics.create({ id: 'ci', name: 'CI', summary: '', summaryInputHash: null, area: null, tailoring: '', driver: null, userRole: 'reviewer', status: 'active', retiredAt: null, createdAt: run.startAt, updatedAt: run.startAt });
        }
        for (const key of run.prKeys) {
          store.memberships.assign({ prKey: key, topicId: 'ci', assignedBy: 'agent', reason: 'CI work', createdAt: run.startAt });
        }
        store.close();
      }
    };

    const { out, report } = await simulateStart(options(from), runRound, () => {});

    expect(fileHash(from)).toBe(before);
    expect(runs.map((run) => [run.round, run.arm, run.prKeys.length, run.maxAgentCalls])).toEqual([
      [1, 'old', 2, 0],
      [1, 'combined', 2, 0],
      [2, 'old', 1, 0],
      [2, 'combined', 1, 0],
    ]);
    expect(runs[0]!.agentJobs).toContain('topics');
    expect(runs[1]!.agentJobs).not.toContain('topics');
    expect(report.rounds).toHaveLength(2);
    expect(report.meta.plannedPrs).toEqual({ pinged: 3, found: 0, pulledIn: 0 });
    expect(report.totals.old?.calls).toBe(0);
    const [first, second] = report.rounds;
    expect(first!.arms.combined).toMatchObject({ topics: 1, tiles: 2 });
    expect(second!.arms.combined).toMatchObject({ topics: 1, tiles: 3, churn: { kept: 2, added: 1, gone: 0, moved: [] } });
    expect(report.topics.map((topic) => topic.topicId)).toEqual(['ci']);
    expect(report.glances.compared).toBe(0);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('## Round 2');
    expect(existsSync(join(out, 'report.json'))).toBe(true);
    const arm = Store.open(join(out, 'combined', 'db.sqlite'));
    expect(arm.prs.listAll()).toHaveLength(3);
    expect(arm.glances.getMany(PRS.map((pr) => pr.key)).size).toBe(0);
    expect(arm.meta.get('github_writes')).toBe('off');
    arm.close();
  });

  it('refuses an out folder that already holds a simulation', async () => {
    const from = await sourceDatabase();
    await simulateStart({ ...options(from), rounds: 1 }, (run) => runSimulatedRound(run).then(() => {}), () => {});
    await expect(simulateStart(options(from), async () => {}, () => {})).rejects.toThrow('already holds a simulation');
  });
});

describe('roundEnv', () => {
  it('points the child at the arm files, read-only, with the arm pipeline switch', () => {
    const run: RoundRun = {
      arm: 'combined',
      round: 1,
      armDir: '/scratch/combined',
      databaseFile: '/scratch/combined/db.sqlite',
      instructionsFile: '/scratch/instructions.md',
      startAt: '2026-09-02T12:00:00.000Z',
      prKeys: [],
      maxAgentCalls: 0,
      agentJobs: [],
    };
    expect(roundEnv(run, { POSTPILE_DB: '/elsewhere.sqlite' })).toMatchObject({
      POSTPILE_DB: '/scratch/combined/db.sqlite',
      POSTPILE_READ_ONLY: '1',
      POSTPILE_SYNC_ON_START: '0',
      POSTPILE_TELEMETRY: '0',
      POSTPILE_MAX_AGENT_CALLS: '0',
      POSTPILE_TOPIC_DIGEST: '1',
    });
    expect(roundEnv({ ...run, arm: 'old' }, {}).POSTPILE_TOPIC_DIGEST).toBe('0');
  });
});
