import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pr } from '@postpile/core';
import { at, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { runSimulatedRound } from '@postpile/engine';
import { makeHarness } from '@postpile/engine/testing';
import { reviewRequestedPr } from '@postpile/engine/testing/prs';
import { Store } from '@postpile/store';
import type { SimulateStartOptions } from './simulate-args.ts';
import { currentPullIns, refuseAppDataPath, simulateStart, type RoundRun } from './simulate-start.ts';
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
async function sourceDatabase(prs: Pr[] = PRS): Promise<string> {
  const file = join(dir, 'source.sqlite');
  const h = makeHarness({ store: Store.open(file) });
  for (const pr of prs) {
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

  it('refuses an out folder that holds anything, and leaves its files alone', async () => {
    const from = await sourceDatabase();
    await simulateStart({ ...options(from), rounds: 1 }, (run) => runSimulatedRound(run).then(() => {}), () => {});
    await expect(simulateStart(options(from), async () => {}, () => {})).rejects.toThrow('not empty');

    const other = join(dir, 'notes');
    mkdirSync(other);
    writeFileSync(join(other, 'report.json'), 'mine');
    await expect(simulateStart({ ...options(from), out: other }, async () => {}, () => {})).rejects.toThrow('not empty');
    expect(readFileSync(join(other, 'report.json'), 'utf8')).toBe('mine');
  });

  it('refuses a source without a viewer before copying anything', async () => {
    const from = join(dir, 'never-synced.sqlite');
    Store.open(from).close();

    await expect(simulateStart(options(from), async () => {}, () => {})).rejects.toThrow('synced at least once');
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('counts agent calls from the first moment of a round, whatever format the source times have', async () => {
    // GitHub's times come without milliseconds; the app's own, like a call's time, with them.
    const from = await sourceDatabase(PRS.map((pr) => ({ ...pr, updatedAt: '2026-09-01T09:02:00Z' })));
    const runRound = async (run: RoundRun): Promise<void> => {
      const store = Store.open(run.databaseFile);
      const at = new Date(new Date(run.startAt).getTime() + 5).toISOString();
      store.agentCalls.add({ runId: 'round', kind: 'glance_batch', topicId: null, model: 'fake', ok: true, attempt: 1, durationMs: 5, costUsd: null, at });
      store.close();
    };

    const { report } = await simulateStart({ ...options(from), arms: ['old'] }, runRound, () => {});

    expect(report.meta.now).toMatch(/\.\d{3}Z$/);
    expect(report.rounds.map((round) => round.arms.old?.calls.calls)).toEqual([1, 1]);
  });
});

describe('refuseAppDataPath', () => {
  it('refuses any folder under Application Support, case and symlinks aside, and allows others', () => {
    const home = join(dir, 'home');
    mkdirSync(join(home, 'Library', 'Application Support', 'code-manager'), { recursive: true });
    symlinkSync(join(home, 'Library', 'Application Support'), join(dir, 'link'));

    expect(() => refuseAppDataPath(join(home, 'Library', 'Application Support', 'code-manager', 'out'), {}, home)).toThrow('Application Support');
    expect(() => refuseAppDataPath(join(home, 'library', 'application support', 'PostPile-dev', 'out'), {}, home)).toThrow('Application Support');
    expect(() => refuseAppDataPath(join(dir, 'link', 'PostPile', 'out'), {}, home)).toThrow('Application Support');
    expect(() => refuseAppDataPath(join(dir, 'simulations', 'out'), {}, home)).not.toThrow();
  });

  it('refuses the XDG data and config folders, from the env or their defaults', () => {
    const home = join(dir, 'home');
    expect(() => refuseAppDataPath(join(dir, 'xdg-data', 'postpile', 'out'), { XDG_DATA_HOME: join(dir, 'xdg-data') }, home)).toThrow('xdg-data');
    expect(() => refuseAppDataPath(join(home, '.local', 'share', 'postpile'), {}, home)).toThrow('.local');
    expect(() => refuseAppDataPath(join(home, '.config', 'code-manager', 'out'), {}, home)).toThrow('.config');
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
      pingedKeys: [],
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

describe('currentPullIns', () => {
  it('keeps a stored pull-in only while its layer still sits in its anchor\'s stack', () => {
    const store = Store.open(':memory:');
    const bottom = makePr({ number: 1, baseRef: 'main', headRef: 's1' });
    const layer = makePr({ number: 2, baseRef: 's1', headRef: 's2' });
    const restacked = makePr({ number: 3, baseRef: 'main', headRef: 'own-branch' });
    for (const pr of [bottom, layer, restacked]) {
      store.prs.upsert(pr, at(0));
    }
    store.pullIns.put({ prKey: layer.key, anchorPrKey: bottom.key, reason: 'stack layer above #1', pulledAt: at(0) });
    store.pullIns.put({ prKey: restacked.key, anchorPrKey: bottom.key, reason: 'stack layer above #1', pulledAt: at(0) });

    expect(currentPullIns(store).map((pullIn) => pullIn.prKey)).toEqual([layer.key]);
    store.close();
  });
});
