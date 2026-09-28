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
    '--tools',
    '',
  ];
}

/** The user's effort setting leaks into -p calls; this turns thinking off. */
export const claudeEnv = { MAX_THINKING_TOKENS: '0' };

interface ClaudeJsonResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
}

export function parseClaudeOutput(stdout: string): { text: string; costUsd: number | null } {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeJsonResult;
  } catch {
    throw new Error(`claude printed something that is not JSON: ${stdout.slice(0, 500)}`);
  }
  if (parsed.is_error || typeof parsed.result !== 'string') {
    throw new Error(`claude returned an error: ${stdout.slice(0, 500)}`);
  }
  return { text: parsed.result.trim(), costUsd: parsed.total_cost_usd ?? null };
}

export interface ClaudeCliRunnerOptions {
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
 * fixes PATH at launch so ~/.local/bin/claude resolves.
 */
export class ClaudeCliRunner implements AgentRunner {
  private readonly binary: string;
  private readonly limiter: ConcurrencyLimiter;

  constructor(options: ClaudeCliRunnerOptions = {}) {
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
          const { text, costUsd } = parseClaudeOutput(stdout);
          settle(null, { text, model: request.model, durationMs: Date.now() - started, costUsd });
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
