import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCliRunner, claudeArgs, inputHash, parseClaudeOutput } from './index.ts';

/** A stand-in `claude` binary: a shell script, so no real model is ever called. */
function fakeClaude(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'code-manager-agent-'));
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

const request = { purpose: 'glance_batch' as const, model: 'claude-haiku-4-5', prompt: 'hello', timeoutMs: 5000 };

describe('claude cli runner', () => {
  it('strips settings, MCP and tools for speed', () => {
    const args = claudeArgs('claude-haiku-4-5');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual([
      '--output-format',
      'json',
    ]);
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
  });

  it('parses the json result envelope', () => {
    const out = parseClaudeOutput('{"type":"result","result":" hi ","is_error":false,"total_cost_usd":0.001}');
    expect(out).toEqual({ text: 'hi', costUsd: 0.001 });
  });

  it('rejects an error envelope', () => {
    expect(() => parseClaudeOutput('{"type":"result","result":"x","is_error":true}')).toThrow('claude returned an error');
  });

  it('hashes inputs stably', () => {
    expect(inputHash('a', { b: 1 })).toBe(inputHash('a', { b: 1 }));
    expect(inputHash('a')).not.toBe(inputHash('b'));
  });

  it('sends the prompt on stdin and turns thinking off', async () => {
    // Echoes stdin and the env var back inside the result envelope.
    const binary = fakeClaude(
      'input=$(cat); printf \'{"type":"result","is_error":false,"result":"%s|%s|%s"}\' "$input" "$MAX_THINKING_TOKENS" "$6"',
    );
    const response = await new ClaudeCliRunner({ binary }).run(request);
    expect(response.text).toBe('hello|0|claude-haiku-4-5');
    expect(response.model).toBe('claude-haiku-4-5');
  });

  it('reports a non-zero exit with stderr', async () => {
    const binary = fakeClaude('cat >/dev/null; echo "not logged in" >&2; exit 1');
    await expect(new ClaudeCliRunner({ binary }).run(request)).rejects.toThrow('claude exited with 1: not logged in');
  });

  it('kills a call that runs past its timeout', async () => {
    const binary = fakeClaude('sleep 5');
    await expect(new ClaudeCliRunner({ binary }).run({ ...request, timeoutMs: 100 })).rejects.toThrow('timed out after 100ms');
  });
});
