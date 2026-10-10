import { ALL_AGENT_JOBS, SYNC_MAX_PRS, type AgentJob, type ConsolidateOptions, type SyncOptions } from '@postpile/core';
import { DEFAULT_SIMULATION_CALLS, parseSimulateRoundFlags, parseSimulateStartFlags, type SimulateRoundOptions, type SimulateStartOptions } from './simulate/simulate-args.ts';

export type Command =
  | { name: 'sync'; options: SyncOptions }
  | { name: 'consolidate'; options: ConsolidateOptions }
  | { name: 'poll' }
  | { name: 'sweep' }
  | { name: 'setup-draft' }
  | { name: 'tools' }
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'pr'; prKey: string }
  /** api: the fake server whose engine to share (--api); plain `mcp` opens its own. */
  | { name: 'mcp'; api?: string }
  | { name: 'simulate-start'; options: SimulateStartOptions }
  | { name: 'simulate-round'; options: SimulateRoundOptions }
  /** problem: what was wrong with the command line, printed above the usage (exit 2); null when help was asked for. */
  | { name: 'help'; problem: string | null };

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
  setup-draft          run the setup checks, sweep and draft; prints the draft with its sources, writes no instructions
  tools                check gh and claude: found where, logged in, and the exact fix when not
  topics               list topics with unread counts
  topic <id>           show a topic: dossier, changes since seen, tiles
  pr <owner/repo#n>    show one PR: glance, facts and events
  mcp                  MCP server on stdin/stdout (always without the lock): claude mcp add postpile -- pnpm -C <repo> cli mcp
                       never writes to GitHub; agents can leave notes on PRs and suggest topic changes, the user accepts or clears them
    --api <url>          sample data only: share the engine of a running POSTPILE_FAKE=1 server (token in POSTPILE_TOKEN)
  simulate-start --from <db> [flags]  a new user's first syncs on a copy, once per agent pipeline; writes report.md
    --days <n>           only threads of the last n days (default 7)
    --round-size <n>     pinged PRs per round (default ${SYNC_MAX_PRS})
    --out <dir>          scratch folder (default a new one under the temp folder)
    --arms <list>        old,combined (default both; the first assigns topics)
    --max-agent-calls <n>  per arm and round (default ${DEFAULT_SIMULATION_CALLS})
    --rounds <n>         stop after n rounds
    --now <iso>          default: the newest activity in the source
    --dry-run            everything but agent calls

  --read-only          (topics, topic, pr, tools) read the database while the app holds it; no GitHub writes

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

/** Commands that take no arguments at all. */
const PLAIN_COMMANDS = ['topics', 'mcp', 'poll', 'sweep', 'setup-draft', 'tools'] as const;

function isPlainCommand(name: string): name is (typeof PLAIN_COMMANDS)[number] {
  return (PLAIN_COMMANDS as readonly string[]).includes(name);
}

/** Usage with a line saying what was wrong. */
function badUsage(problem: string): Command {
  return { name: 'help', problem };
}

function badFlags(name: string, flags: string[]): Command {
  return badUsage(flags.length === 0 ? `${name} is missing flags` : `bad flags for ${name}: ${flags.join(' ')}`);
}

export function parseArgs(argv: string[]): Command {
  const [name, arg, ...rest] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    return { name: 'help', problem: null };
  }
  if (name === 'sync') {
    const options = parseSyncFlags(argv.slice(1));
    return options ? { name, options } : badFlags(name, argv.slice(1));
  }
  if (name === 'consolidate') {
    const options = parseConsolidateFlags(argv.slice(1));
    return options ? { name, options } : badFlags(name, argv.slice(1));
  }
  if (name === 'simulate-start') {
    const options = parseSimulateStartFlags(argv.slice(1));
    return options ? { name, options } : badFlags(name, argv.slice(1));
  }
  // Hidden: simulate-start runs it as a child process per arm and round.
  if (name === 'simulate-round') {
    const options = parseSimulateRoundFlags(argv.slice(1));
    return options ? { name, options } : badFlags(name, argv.slice(1));
  }
  const [apiUrl] = rest;
  if (name === 'mcp' && arg === '--api') {
    const valid = rest.length === 1 && apiUrl !== undefined && /^https?:\/\//.test(apiUrl);
    return valid ? { name, api: apiUrl.replace(/\/+$/, '') } : badUsage('mcp --api needs one http(s) URL');
  }
  if (isPlainCommand(name)) {
    return arg === undefined ? { name } : badUsage(`${name} takes no arguments`);
  }
  if (name === 'topic') {
    return arg && rest.length === 0 ? { name, topicId: arg } : badUsage('topic needs one topic id, e.g. topic topic-depot');
  }
  if (name === 'pr') {
    return arg && rest.length === 0 ? { name, prKey: arg } : badUsage('pr needs one PR key, e.g. pr acme/app#1902');
  }
  return badUsage(`unknown command ${name}`);
}

/** Commands that only read the store, so they may run next to the app with --read-only. */
const READ_COMMANDS: Command['name'][] = ['topics', 'topic', 'pr', 'tools', 'help'];

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
  const error = readOnly && !READ_COMMANDS.includes(command.name) ? `--read-only only works with topics, topic, pr and tools, not ${command.name}` : null;
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
