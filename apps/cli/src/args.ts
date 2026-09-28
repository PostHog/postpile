import { ALL_AGENT_JOBS, type AgentJob, type ConsolidateOptions, type SyncOptions } from '@postpile/core';

export type Command =
  | { name: 'sync'; options: SyncOptions }
  | { name: 'consolidate'; options: ConsolidateOptions }
  | { name: 'poll' }
  | { name: 'sweep' }
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'pr'; prKey: string }
  | { name: 'help' };

export const usage = `usage: postpile <command>

  sync [flags]         fetch notifications, digest, derive tiles
    --limit <n>          enrich at most n PRs (newest first); the rest follow on later syncs
    --no-agent           no agent calls at all
    --max-agent-calls <n>  default POSTPILE_MAX_AGENT_CALLS, else 150
    --agent-jobs <list>  comma separated: ${ALL_AGENT_JOBS.join(',')}
  consolidate [flags]  propose topic merges/splits/renames and rules, retire finished topics
    --if-due             only when 24h passed and a dossier changed since the last run
    --max-agent-calls <n>
  poll                 one fast-poll cycle: inbox check, changed PRs, ping decisions (no Mac notification)
  sweep                write "what you're working on" from ~/.claude (POSTPILE_CLAUDE_DIR), one agent call
  topics               list topics with unread counts
  topic <id>           show a topic: dossier, changes since seen, tiles
  pr <owner/repo#n>    show one PR: glance, facts and events

  --read-only          (topics, topic, pr) read the database while the app holds it; no GitHub writes

POSTPILE_FAKE=1 runs on built-in sample data (no GitHub, no agent).
From the repo (pnpm cli) the dev database is used; POSTPILE_PROFILE=default pnpm cli ... reads the real one.`;

function positiveInt(value: string | undefined, allowZero: boolean): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    return null;
  }
  return number;
}

function agentJobs(value: string | undefined): AgentJob[] | null {
  const jobs = (value ?? '').split(',').filter((job) => job !== '');
  const valid = jobs.every((job) => (ALL_AGENT_JOBS as string[]).includes(job));
  return valid && jobs.length > 0 ? (jobs as AgentJob[]) : null;
}

/** Returns null on a bad flag so the caller shows usage. */
function parseSyncFlags(flags: string[]): SyncOptions | null {
  const options: SyncOptions = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--no-agent') {
      options.maxAgentCalls = 0;
      continue;
    }
    const value = flags[++i];
    if (flag === '--limit') {
      const limit = positiveInt(value, false);
      if (limit === null) {
        return null;
      }
      options.maxPrs = limit;
    } else if (flag === '--max-agent-calls') {
      const max = positiveInt(value, true);
      if (max === null) {
        return null;
      }
      options.maxAgentCalls = max;
    } else if (flag === '--agent-jobs') {
      const jobs = agentJobs(value);
      if (jobs === null) {
        return null;
      }
      options.agentJobs = jobs;
    } else {
      return null;
    }
  }
  return options;
}

/** Returns null on a bad flag so the caller shows usage. */
function parseConsolidateFlags(flags: string[]): ConsolidateOptions | null {
  const options: ConsolidateOptions = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--if-due') {
      options.onlyIfDue = true;
    } else if (flag === '--max-agent-calls') {
      const max = positiveInt(flags[++i], true);
      if (max === null) {
        return null;
      }
      options.maxAgentCalls = max;
    } else {
      return null;
    }
  }
  return options;
}

export function parseArgs(argv: string[]): Command {
  const [name, arg, ...rest] = argv;
  if (name === 'sync') {
    const options = parseSyncFlags(argv.slice(1));
    return options ? { name, options } : { name: 'help' };
  }
  if (name === 'consolidate') {
    const options = parseConsolidateFlags(argv.slice(1));
    return options ? { name, options } : { name: 'help' };
  }
  if ((name === 'topics' || name === 'poll' || name === 'sweep') && arg === undefined) {
    return { name };
  }
  if (name === 'topic' && arg && rest.length === 0) {
    return { name, topicId: arg };
  }
  if (name === 'pr' && arg && rest.length === 0) {
    return { name, prKey: arg };
  }
  return { name: 'help' };
}

/** Commands that only read the store, so they may run next to the app with --read-only. */
const READ_COMMANDS: Command['name'][] = ['topics', 'topic', 'pr', 'help'];

export interface Invocation {
  command: Command;
  /** --read-only: no database lock, no GitHub writes. */
  readOnly: boolean;
  /** Set when the flags do not fit together. */
  error: string | null;
}

/** parseArgs plus the global --read-only flag, which only read commands take. */
export function parseInvocation(argv: string[]): Invocation {
  const readOnly = argv.includes('--read-only');
  const command = parseArgs(argv.filter((arg) => arg !== '--read-only'));
  const error = readOnly && !READ_COMMANDS.includes(command.name) ? `--read-only only works with topics, topic and pr, not ${command.name}` : null;
  return { command, readOnly, error };
}

/**
 * sync and consolidate without --max-agent-calls get the app's cap
 * (POSTPILE_MAX_AGENT_CALLS, else its default), so a plain CLI run is never
 * uncapped. Other commands pass through.
 */
export function withCallCap(command: Command, cap: number): Command {
  if (command.name === 'sync') {
    return { name: 'sync', options: { ...command.options, maxAgentCalls: command.options.maxAgentCalls ?? cap } };
  }
  if (command.name === 'consolidate') {
    return { name: 'consolidate', options: { ...command.options, maxAgentCalls: command.options.maxAgentCalls ?? cap } };
  }
  return command;
}
