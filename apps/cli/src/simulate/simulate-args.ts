import { ALL_AGENT_JOBS, SYNC_MAX_PRS, type AgentJob, type IsoTime } from '@postpile/core';

/** old: the agent pipeline as it is (POSTPILE_TOPIC_DIGEST=0). combined: the per-topic digest call (POSTPILE_TOPIC_DIGEST=1). */
export type ArmName = 'old' | 'combined';

export const ARM_NAMES: ArmName[] = ['old', 'combined'];

/** Per arm and round; high, since cost is not the question here and a cap would make the arms differ. */
export const DEFAULT_SIMULATION_CALLS = 1000;

export interface SimulateStartOptions {
  /** The database to start from, opened read-only and copied. */
  from: string;
  days: number;
  roundSize: number;
  /** Null: a new folder under the system temp folder. */
  out: string | null;
  /** The first arm assigns topics; the others take its topics. */
  arms: ArmName[];
  maxAgentCalls: number;
  /** Stop after this many rounds; null runs the whole window. */
  rounds: number | null;
  /** Everything but agent calls. */
  dryRun: boolean;
  /** Null: the newest activity in the source database. */
  now: IsoTime | null;
}

/** The hidden child command: one round of one arm. The database and instructions come from POSTPILE_DB and POSTPILE_INSTRUCTIONS. */
export interface SimulateRoundOptions {
  startAt: IsoTime;
  /** JSON file with the round's PR keys. */
  keysFile: string;
  maxAgentCalls: number;
  agentJobs: AgentJob[];
}

function wholeNumber(value: string | undefined, min: number): number | null {
  const number = Number(value);
  return value !== undefined && Number.isInteger(number) && number >= min ? number : null;
}

function isoTime(value: string | undefined): IsoTime | null {
  return value !== undefined && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function armNames(value: string | undefined): ArmName[] | null {
  const arms = (value ?? '').split(',').filter((arm) => arm !== '');
  const valid = arms.length > 0 && arms.every((arm) => (ARM_NAMES as string[]).includes(arm)) && new Set(arms).size === arms.length;
  return valid ? (arms as ArmName[]) : null;
}

function agentJobList(value: string | undefined): AgentJob[] | null {
  const jobs = (value ?? '').split(',').filter((job) => job !== '');
  return jobs.every((job) => (ALL_AGENT_JOBS as string[]).includes(job)) ? (jobs as AgentJob[]) : null;
}

/** Null on a bad or missing flag, so the caller shows usage. */
export function parseSimulateStartFlags(flags: string[]): SimulateStartOptions | null {
  const options: SimulateStartOptions = {
    from: '',
    days: 7,
    roundSize: SYNC_MAX_PRS,
    out: null,
    arms: [...ARM_NAMES],
    maxAgentCalls: DEFAULT_SIMULATION_CALLS,
    rounds: null,
    dryRun: false,
    now: null,
  };
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = flags[++i];
    if (flag === '--from' && value) {
      options.from = value;
    } else if (flag === '--out' && value) {
      options.out = value;
    } else if (flag === '--days' && wholeNumber(value, 1) !== null) {
      options.days = wholeNumber(value, 1)!;
    } else if (flag === '--round-size' && wholeNumber(value, 1) !== null) {
      options.roundSize = wholeNumber(value, 1)!;
    } else if (flag === '--max-agent-calls' && wholeNumber(value, 0) !== null) {
      options.maxAgentCalls = wholeNumber(value, 0)!;
    } else if (flag === '--rounds' && wholeNumber(value, 1) !== null) {
      options.rounds = wholeNumber(value, 1)!;
    } else if (flag === '--arms' && armNames(value) !== null) {
      options.arms = armNames(value)!;
    } else if (flag === '--now' && isoTime(value) !== null) {
      options.now = isoTime(value);
    } else {
      return null;
    }
  }
  return options.from === '' ? null : options;
}

/** Null on a bad or missing flag. */
export function parseSimulateRoundFlags(flags: string[]): SimulateRoundOptions | null {
  let startAt: IsoTime | null = null;
  let keysFile: string | null = null;
  let maxAgentCalls: number | null = null;
  let agentJobs: AgentJob[] | null = null;
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (flag === '--start-at') {
      startAt = isoTime(value);
    } else if (flag === '--keys' && value) {
      keysFile = value;
    } else if (flag === '--max-agent-calls') {
      maxAgentCalls = wholeNumber(value, 0);
    } else if (flag === '--agent-jobs') {
      agentJobs = agentJobList(value);
    } else {
      return null;
    }
  }
  if (startAt === null || keysFile === null || maxAgentCalls === null || agentJobs === null) {
    return null;
  }
  return { startAt, keysFile, maxAgentCalls, agentJobs };
}
