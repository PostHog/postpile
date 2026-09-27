import { describe, expect, it } from 'vitest';
import { claudeArgs, inputHash, parseClaudeOutput } from './index.ts';

describe('claude cli runner', () => {
  it('strips settings, MCP and tools for speed', () => {
    const args = claudeArgs('claude-haiku-4-5');
    expect(args).toContain('--strict-mcp-config');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual([
      '--output-format',
      'json',
    ]);
  });

  it('parses the json result envelope', () => {
    const out = parseClaudeOutput('{"type":"result","result":" hi ","is_error":false,"total_cost_usd":0.001}');
    expect(out).toEqual({ text: 'hi', costUsd: 0.001 });
  });

  it('hashes inputs stably', () => {
    expect(inputHash('a', { b: 1 })).toBe(inputHash('a', { b: 1 }));
    expect(inputHash('a')).not.toBe(inputHash('b'));
  });
});
