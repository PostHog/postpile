// `pnpm cli simulate-start`: a brand-new user starts PostPile on an inbox
// they never cleared and picks "start with the last N days". The same fresh
// start runs through each agent pipeline (arm), round by round as the
// backlog would drain, and the report compares them. Never asks GitHub,
// never writes to the source database.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { ALL_AGENT_JOBS, buildStacks, planRounds, roundPrKeys, simulationNow, type AgentJob, type IsoTime, type PrKey, type SimulationPullIn, type SimulationRound } from '@postpile/core';
import { ArmDatabase, BACKLOG_SYNC_MINUTES, readArmSnapshot, STACK_DEPTH, startFresh } from '@postpile/engine';
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
  /** Every PR the round reveals. */
  prKeys: PrKey[];
  /** The ones picked from the inbox: only their events count as new, as in a real sync. */
  pingedKeys: PrKey[];
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

/** The absolute path with symlinks resolved, also for a path that does not exist yet: the nearest existing folder is resolved, the rest is appended. */
function resolvedPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}

/** Case-insensitive, as APFS compares names. Elsewhere it can only refuse more, never less. */
function isInside(path: string, folder: string): boolean {
  const lowerPath = path.toLowerCase();
  const lowerFolder = folder.toLowerCase();
  return lowerPath === lowerFolder || lowerPath.startsWith(lowerFolder.endsWith(sep) ? lowerFolder : lowerFolder + sep);
}

/**
 * Refuses a path under any folder where apps keep their data or config:
 * ~/Library/Application Support and the XDG data and config folders. That
 * covers PostPile's real, dev and old code-manager folders without naming
 * each one. The simulation only ever writes to its out folder.
 */
export function refuseAppDataPath(path: string, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): void {
  const folders = [join(home, 'Library', 'Application Support'), env.XDG_DATA_HOME || join(home, '.local', 'share'), env.XDG_CONFIG_HOME || join(home, '.config')];
  const full = resolvedPath(path);
  for (const folder of folders) {
    if (isInside(full, resolvedPath(folder))) {
      throw new Error(`${path} is inside ${folder}, where apps (PostPile too) keep their data; simulate-start only writes to its own out folder, pick one elsewhere`);
    }
  }
}

/**
 * Refuses a source database the rounds cannot digest, before anything is
 * copied. Plain SQL on purpose: the source may be on an older schema (the
 * store refuses those read-only), and only the copy gets migrated.
 */
function checkSource(from: string): void {
  const source = new DatabaseSync(from, { readOnly: true });
  try {
    const viewer = source.prepare("SELECT 1 FROM meta WHERE key = 'viewer'").get();
    if (viewer === undefined) {
      throw new Error('the database holds no viewer: simulate-start needs a database that synced at least once');
    }
  } finally {
    source.close();
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

/**
 * Stack layers as a fresh sync would pull them in, from today's stack shape:
 * every stored PR nobody tracks (no thread, not found) comes in with each
 * tracked PR of its current stack at most STACK_DEPTH layers away, the
 * sync's own walk limit. Stored pull-in rows are not used: they outlive
 * later syncs and keep the anchor a layer had before a rebase.
 */
export function currentPullIns(store: Store, tracked: Set<PrKey>): SimulationPullIn[] {
  const pullIns: SimulationPullIn[] = [];
  for (const stack of buildStacks(store.prs.listLight())) {
    const keys = stack.prKeys;
    for (let layer = 0; layer < keys.length; layer++) {
      for (let anchor = 0; anchor < keys.length; anchor++) {
        const close = Math.abs(layer - anchor) <= STACK_DEPTH;
        if (close && !tracked.has(keys[layer]!) && tracked.has(keys[anchor]!)) {
          pullIns.push({ prKey: keys[layer]!, anchorPrKey: keys[anchor]! });
        }
      }
    }
  }
  return pullIns;
}

/** The rounds to run, from the fresh-start copy. */
function planSimulation(store: Store, options: SimulateStartOptions): Plan {
  const threads = (store.db.prepare('SELECT pr_key, unread, updated_at FROM notification_thread WHERE pr_key IS NOT NULL').all() as { pr_key: string; unread: number; updated_at: string }[]).map(
    (row) => ({ key: row.pr_key, unread: row.unread !== 0, updatedAt: row.updated_at }),
  );
  const prs = store.db.prepare('SELECT key, updated_at FROM pr').all() as { key: string; updated_at: string }[];
  const newestStored = simulationNow([...threads.map((thread) => thread.updatedAt), ...prs.map((pr) => pr.updated_at)]);
  // The copies hold every snapshot and event up to the newest activity, so an earlier "now" would feed later activity into the rounds.
  if (options.now !== null && newestStored !== null && new Date(options.now).getTime() < new Date(newestStored).getTime()) {
    throw new Error(`--now ${options.now} is before the newest stored activity (${new Date(newestStored).toISOString()}); pick that time or later`);
  }
  const newest = options.now ?? newestStored;
  // Written as toISOString writes it: snapshots compare round times with agent_call.at and pr_set_change.at as strings.
  const now = newest === null ? new Date().toISOString() : new Date(newest).toISOString();
  const found = [...store.foundPrs.listAll().keys()];
  const rounds = planRounds({
    threads,
    found,
    pullIns: currentPullIns(store, new Set([...threads.map((thread) => thread.key), ...found])),
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
function prepareArm(out: string, arms: ArmName[], armIndex: number, round: SimulationRound, startAt: IsoTime): void {
  const database = ArmDatabase.open(armFile(out, arms[armIndex]!));
  try {
    database.reveal(join(out, 'base.sqlite'), round);
    if (armIndex > 0) {
      database.copyTopicsFrom(armFile(out, arms[0]!), startAt);
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

/**
 * Refuses an --out that holds anything: the simulation writes databases,
 * reports and instructions there, and an SQLite backup replaces a file
 * without asking. A new or empty folder only.
 */
function refuseUsedFolder(out: string): void {
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`${out} is not empty; simulate-start only writes into a new or empty folder, pick another --out`);
  }
}

/** Copies the source, makes the fresh start and the arm databases. Returns the plan. */
async function prepare(options: SimulateStartOptions, out: string): Promise<Plan> {
  const baseFile = join(out, 'base.sqlite');
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
  refuseUsedFolder(out);
  checkSource(options.from);
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
      prepareArm(out, options.arms, armIndex, round, startAt);
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
        pingedKeys: round.pinged,
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
