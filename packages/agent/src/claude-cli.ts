import { spawn } from 'node:child_process';
import type { AgentRequest, AgentResponse, AgentRunner } from './runner.ts';

/**
 * Flags carried over from ghatchup's runQuick, measured there: loading user
 * settings, MCP servers, tools and extended thinking took a PR summary from
 * ~3s to ~30s. The prompt carries everything, so none of it is needed.
 * --tools takes a variadic list and would swallow a trailing prompt, which is
 * why the prompt goes in on stdin.
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
  const parsed = JSON.parse(stdout) as ClaudeJsonResult;
  if (parsed.is_error || typeof parsed.result !== 'string') {
    throw new Error(`claude returned an error: ${stdout.slice(0, 500)}`);
  }
  return { text: parsed.result.trim(), costUsd: parsed.total_cost_usd ?? null };
}

export class ClaudeCliRunner implements AgentRunner {
  constructor(private readonly binary: string = 'claude') {}

  run(request: AgentRequest): Promise<AgentResponse> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, claudeArgs(request.model), {
        env: { ...process.env, ...claudeEnv },
        timeout: request.timeoutMs,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with ${code}: ${stderr.trim() || stdout.slice(0, 500)}`));
          return;
        }
        try {
          const { text, costUsd } = parseClaudeOutput(stdout);
          resolve({ text, model: request.model, durationMs: Date.now() - started, costUsd });
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(request.prompt);
    });
  }
}
