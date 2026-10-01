// `pnpm cli simulate-start`: a brand-new user starts PostPile on an inbox
// they never cleared and picks "start with the last N days". The same fresh
// start runs through each agent pipeline (arm), round by round as the
// backlog would drain, and the report compares them. Never asks GitHub,
// never writes to the source database.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { ALL_AGENT_JOBS, planRounds, roundPrKeys, simulationNow, type AgentJob, type IsoTime, type PrKey, type SimulationRound } from '@postpile/core';
import { ArmDatabase, BACKLOG_SYNC_MINUTES, dataDirs, readArmSnapshot, realDataDirs, startFresh } from '@postpile/engine';
import { Store } from '@postpile/store';
import { formatReportMarkdown } from './report-markdown.ts';
import { buildReport, type ReportMeta, type RoundRecord, type SimulationReport } from './report.ts';
import type { ArmName, SimulateStartOptions } from './simulate-args.ts';

/** One round of one arm, as the runner gets it. */
export interface RoundRun {
  arm: ArmName;
  /** 1, 2, 3, ... */
  round: number;
  armDir: string;
  databaseFile: string;
  instructionsFile: string;
  startAt: IsoTime;
  prKeys: PrKey[];
  maxAgentCalls: number;
  agentJobs: AgentJob[];
}

/** Runs the round's digest on the arm's database. The CLI spawns a child process; tests run it in-process. */
export type RoundRunner = (run: RoundRun) => Promise<void>;

export interface SimulationResult {
  out: string;
  report: SimulationReport;
}

interface Plan {
  now: IsoTime;
  rounds: SimulationRound[];
}

/** Refuses a path inside the app's own data folders (real or dev): the simulation only ever writes to its out folder. */
export function refuseAppDataPath(path: string): void {
  const pathEnv = { env: { POSTPILE_PROFILE: 'dev' }, platform: process.platform, home: homedir() };
  const folders = [realDataDirs().dataDir, dataDirs(pathEnv).dataDir];
  const full = resolve(path);
  for (const folder of folders) {
    if (full === folder || full.startsWith(folder + sep)) {
      throw new Error(`${path} is inside ${folder}; simulate-start only writes to its own out folder`);
    }
  }
}

/** A consistent copy of a database that may be in use, opened read-only. */
async function copyDatabase(from: string, to: string): Promise<void> {
  const source = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(source, to);
  } finally {
    source.close();
  }
}

/** The rounds to run, from the fresh-start copy. */
function planSimulation(store: Store, options: SimulateStartOptions): Plan {
  const threads = (store.db.prepare('SELECT pr_key, unread, updated_at FROM notification_thread WHERE pr_key IS NOT NULL').all() as { pr_key: string; unread: number; updated_at: string }[]).map(
    (row) => ({ key: row.pr_key, unread: row.unread !== 0, updatedAt: row.updated_at }),
  );
  const prs = store.db.prepare('SELECT key, updated_at FROM pr').all() as { key: string; updated_at: string }[];
  const now = options.now ?? simulationNow([...threads.map((thread) => thread.updatedAt), ...prs.map((pr) => pr.updated_at)]) ?? new Date().toISOString();
  const rounds = planRounds({
    threads,
    found: [...store.foundPrs.listAll().keys()],
    pullIns: [...store.pullIns.listAll().values()],
    stored: new Set(prs.map((pr) => pr.key)),
    now,
    days: options.days,
    roundSize: options.roundSize,
  });
  return { now, rounds };
}

/** The instructions the source database last recorded, so prompts read what the user had; empty when none. */
function writeInstructions(store: Store, file: string): void {
  writeFileSync(file, store.instructions.latest()?.text ?? '');
}

function plannedPrs(rounds: SimulationRound[]): ReportMeta['plannedPrs'] {
  return {
    pinged: rounds.reduce((sum, round) => sum + round.pinged.length, 0),
    found: rounds.reduce((sum, round) => sum + round.found.length, 0),
    pulledIn: rounds.reduce((sum, round) => sum + round.pulledIn.length, 0),
  };
}

function writeReport(out: string, report: SimulationReport): void {
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'report.md'), formatReportMarkdown(report));
}

function armFile(out: string, arm: ArmName): string {
  return join(out, arm, 'db.sqlite');
}

/**
 * The first arm assigns topics; the others take its topics and memberships
 * before their own digest, so every arm digests the same topics.
 */
function jobsFor(armIndex: number): AgentJob[] {
  return armIndex === 0 ? ALL_AGENT_JOBS : ALL_AGENT_JOBS.filter((job) => job !== 'topics');
}

/** Reveals the round in one arm's database (and takes the leader's topics for a follower). */
function prepareArm(out: string, arms: ArmName[], armIndex: number, round: SimulationRound): void {
  const database = ArmDatabase.open(armFile(out, arms[armIndex]!));
  try {
    database.reveal(join(out, 'base.sqlite'), round);
    if (armIndex > 0) {
      database.copyTopicsFrom(armFile(out, arms[0]!));
    }
  } finally {
    database.close();
  }
}

function snapshotArms(out: string, arms: ArmName[], now: IsoTime, since: IsoTime): RoundRecord['arms'] {
  const snapshots: RoundRecord['arms'] = {};
  for (const arm of arms) {
    const database = ArmDatabase.open(armFile(out, arm));
    try {
      snapshots[arm] = readArmSnapshot(database.store, now, since);
    } finally {
      database.close();
    }
  }
  return snapshots;
}

/** Copies the source, makes the fresh start and the arm databases. Returns the plan. */
async function prepare(options: SimulateStartOptions, out: string): Promise<Plan> {
  const baseFile = join(out, 'base.sqlite');
  if (existsSync(baseFile)) {
    throw new Error(`${out} already holds a simulation; pick another --out`);
  }
  await copyDatabase(options.from, join(out, 'source.sqlite'));
  await copyDatabase(join(out, 'source.sqlite'), baseFile);
  const base = Store.open(baseFile);
  let plan: Plan;
  try {
    startFresh(base);
    plan = planSimulation(base, options);
    writeInstructions(base, join(out, 'instructions.md'));
  } finally {
    base.close();
  }
  for (const arm of options.arms) {
    mkdirSync(join(out, arm), { recursive: true });
    copyFileSync(baseFile, armFile(out, arm));
    const database = ArmDatabase.open(armFile(out, arm));
    database.hidePrs();
    database.close();
  }
  return plan;
}

export async function simulateStart(options: SimulateStartOptions, runRound: RoundRunner, log: (line: string) => void = console.log): Promise<SimulationResult> {
  const out = resolve(options.out ?? mkdtempSync(join(tmpdir(), 'postpile-simulate-')));
  refuseAppDataPath(out);
  mkdirSync(out, { recursive: true });
  const plan = await prepare(options, out);
  const rounds = plan.rounds.slice(0, options.rounds ?? plan.rounds.length);
  const meta: ReportMeta = {
    from: options.from,
    out,
    now: plan.now,
    days: options.days,
    roundSize: options.roundSize,
    arms: options.arms,
    dryRun: options.dryRun,
    plannedRounds: plan.rounds.length,
    plannedPrs: plannedPrs(plan.rounds),
  };
  log(`simulate-start: ${out}, now ${plan.now}, ${plan.rounds.length} rounds planned, running ${rounds.length}`);
  const records: RoundRecord[] = [];
  let report = buildReport(meta, records);
  writeReport(out, report);
  // Every arm starts a round at the same simulated time; the next round starts after the slowest arm, plus the backlog pause.
  let clock = plan.now;
  for (const [i, round] of rounds.entries()) {
    const startAt = clock;
    let slowestMs = 0;
    for (const [armIndex, arm] of options.arms.entries()) {
      prepareArm(out, options.arms, armIndex, round);
      log(`round ${i + 1}/${rounds.length}, ${arm}: ${roundPrKeys(round).length} PRs in`);
      const started = Date.now();
      await runRound({
        arm,
        round: i + 1,
        armDir: join(out, arm),
        databaseFile: armFile(out, arm),
        instructionsFile: join(out, 'instructions.md'),
        startAt,
        prKeys: roundPrKeys(round),
        maxAgentCalls: options.dryRun ? 0 : options.maxAgentCalls,
        agentJobs: jobsFor(armIndex),
      });
      slowestMs = Math.max(slowestMs, Date.now() - started);
    }
    clock = new Date(new Date(startAt).getTime() + slowestMs + BACKLOG_SYNC_MINUTES * 60_000).toISOString();
    records.push({
      index: i + 1,
      startAt,
      prs: { pinged: round.pinged.length, found: round.found.length, pulledIn: round.pulledIn.length },
      arms: snapshotArms(out, options.arms, clock, startAt),
    });
    // After every round, so a stopped run still leaves a report.
    report = buildReport(meta, records);
    writeReport(out, report);
  }
  log(`simulate-start: report in ${join(out, 'report.md')}`);
  return { out, report };
}
