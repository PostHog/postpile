import { spawn } from 'node:child_process';
import { ConcurrencyLimiter } from './limiter.ts';
import type { AgentRequest, AgentResponse, AgentRunner } from './runner.ts';

/**
 * Flags carried over from ghatchup's runQuick, measured there: loading user
 * settings, MCP servers, tools and extended thinking took a PR summary from
 * ~3s to ~30s. The prompt carries everything, so none of it is needed.
 * --tools takes a variadic list and would swallow a trailing prompt, which is
 * why the prompt goes in on stdin. --no-session-persistence keeps every call
 * from leaving a resumable transcript under ~/.claude/projects.
 * --disable-slash-commands and --no-chrome skip skills and the Chrome
 * integration, which a prompt-only call never uses. Not --bare: it never
 * reads the keychain, so a subscription login stops working.
 */
export function claudeArgs(model: string): string[] {
  return [
    '--no-session-persistence',
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-chrome',
    '--tools',
    '',
  ];
}

/**
 * MAX_THINKING_TOKENS: the user's effort setting leaks into -p calls; this
 * turns thinking off. The rest keeps each call to the prompt and the API:
 * no self-update, no telemetry or other side traffic, no CLAUDE.md or auto
 * memory files read (a CLAUDE.md can @-include files anywhere, and macOS
 * asks for permissions in PostPile's name when claude opens them), no
 * claude.ai MCP connectors.
 */
export const claudeEnv = {
  MAX_THINKING_TOKENS: '0',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
};

interface ClaudeJsonResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  /** Per model that answered, keyed by its full id (e.g. "claude-sonnet-5-5"). */
  modelUsage?: Record<string, { costUSD?: number }>;
}

/**
 * The model that actually answered, from the CLI's own usage report: the one
 * that cost the most when several took part. Null when the report is missing
 * (older CLIs); the requested model is recorded then.
 */
function answeringModel(parsed: ClaudeJsonResult): string | null {
  const entries = Object.entries(parsed.modelUsage ?? {});
  if (entries.length === 0) {
    return null;
  }
  entries.sort((a, b) => (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0));
  return entries[0][0];
}

export function parseClaudeOutput(stdout: string): { text: string; costUsd: number | null; model: string | null } {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeJsonResult;
  } catch {
    throw new Error(`claude printed something that is not JSON: ${stdout.slice(0, 500)}`);
  }
  if (parsed.is_error || typeof parsed.result !== 'string') {
    throw new Error(`claude returned an error: ${stdout.slice(0, 500)}`);
  }
  return { text: parsed.result.trim(), costUsd: parsed.total_cost_usd ?? null, model: answeringModel(parsed) };
}

/**
 * Recorded in agent_call. An alias ("opus") resolves to a full id, which is
 * expected; a full id that comes back different means something remapped it
 * (user settings, CLI defaults), which is worth a log line.
 */
function recordedModel(requested: string, answered: string | null): string {
  if (answered === null) {
    return requested;
  }
  if (requested.startsWith('claude-') && answered !== requested) {
    console.warn(`claude answered with ${answered}, asked for ${requested}`);
  }
  return answered;
}

export interface ClaudeCliRunnerOptions {
  /**
   * The folder claude runs in: the app's own empty one, so claude finds no
   * project files, settings or CLAUDE.md there and never looks around the
   * folder the app happened to start in (/ or a repo).
   */
  cwd: string;
  /** Path or name of the claude binary. Default: POSTPILE_CLAUDE_BIN or "claude" on PATH. */
  binary?: string;
  /** Max claude processes at once. Default: POSTPILE_AGENT_CONCURRENCY or 8. */
  maxConcurrent?: number;
}

/**
 * The user is on a Claude subscription, where a sync's 80-odd calls are
 * limited by wall time, not cost. At 4, most of a 5-minute sync sat queued
 * behind the limiter. POSTPILE_AGENT_CONCURRENCY lowers it if the account
 * starts hitting rate limits.
 */
const DEFAULT_MAX_CONCURRENT = 8;

function defaultMaxConcurrent(): number {
  const fromEnv = Number(process.env.POSTPILE_AGENT_CONCURRENCY);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_CONCURRENT;
}

/**
 * Runs the local `claude` CLI in print mode, one process per request. The
 * shell alias `claude` does not exist for a spawned process; the desktop app
 * builds PATH at launch so ~/.local/bin/claude resolves.
 */
export class ClaudeCliRunner implements AgentRunner {
  private readonly binary: string;
  private readonly cwd: string;
  private readonly limiter: ConcurrencyLimiter;

  constructor(options: ClaudeCliRunnerOptions) {
    this.cwd = options.cwd;
    this.binary = options.binary ?? process.env.POSTPILE_CLAUDE_BIN ?? 'claude';
    this.limiter = new ConcurrencyLimiter(options.maxConcurrent ?? defaultMaxConcurrent());
  }

  run(request: AgentRequest): Promise<AgentResponse> {
    return this.limiter.run(() => this.spawnClaude(request));
  }

  private spawnClaude(request: AgentRequest): Promise<AgentResponse> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, claudeArgs(request.model), {
        cwd: this.cwd,
        env: { ...process.env, ...claudeEnv },
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (error: Error | null, response?: AgentResponse) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else if (response) {
          resolve(response);
        }
      };
      // Reject right away instead of waiting for "close": a grandchild that
      // inherited stdout can keep the pipe open long after the kill.
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        settle(new Error(`claude timed out after ${request.timeoutMs}ms (${request.purpose})`));
      }, request.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => settle(new Error(`could not start ${this.binary}: ${error.message}`)));
      child.on('close', (code) => {
        if (code !== 0) {
          settle(new Error(`claude exited with ${code}: ${stderr.trim() || stdout.slice(0, 500)}`));
          return;
        }
        try {
          const { text, costUsd, model } = parseClaudeOutput(stdout);
          settle(null, { text, model: recordedModel(request.model, model), durationMs: Date.now() - started, costUsd });
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
      // A process that dies before reading stdin raises EPIPE here; the close
      // handler above reports the real reason.
      child.stdin.on('error', () => {});
      child.stdin.end(request.prompt);
    });
  }
}
