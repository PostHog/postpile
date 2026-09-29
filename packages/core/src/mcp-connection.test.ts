import { describe, expect, it } from 'vitest';
import { claudeCanManageMcp, mcpAddArgs, mcpAddCommand, mcpServerCommand, mcpServerMissing } from './index.ts';

const APP = { kind: 'app', path: '/Applications/PostPile.app/Contents/Resources/postpile-mcp' } as const;

describe('mcpAddArgs', () => {
  it('adds the app launcher for every project (user scope)', () => {
    expect(mcpAddArgs(APP)).toEqual(['mcp', 'add', '--scope', 'user', 'postpile', '--', APP.path]);
  });

  it('points a dev build at the repo, on the real profile', () => {
    expect(mcpAddArgs({ kind: 'dev', repoRoot: '/src/postpile' })).toEqual([
      'mcp', 'add', 'postpile', '-e', 'POSTPILE_PROFILE=default', '--', 'pnpm', '-C', '/src/postpile', 'cli', 'mcp',
    ]);
  });

  it('falls back to the Homebrew command without a launcher', () => {
    expect(mcpAddArgs(null)).toEqual(['mcp', 'add', 'postpile', '--', 'postpile-mcp']);
  });
});

describe('mcpAddCommand and mcpServerCommand', () => {
  it('read like typed commands', () => {
    expect(mcpAddCommand(APP)).toBe(`claude mcp add --scope user postpile -- ${APP.path}`);
    expect(mcpServerCommand(APP)).toBe(APP.path);
    expect(mcpServerCommand({ kind: 'dev', repoRoot: '/src/postpile' })).toBe('POSTPILE_PROFILE=default pnpm -C /src/postpile cli mcp');
    expect(mcpServerCommand(null)).toBe('postpile-mcp');
  });

  it('quotes a path with a space or a quote', () => {
    const moved = { kind: 'app', path: "/Users/alice/My Apps/Rowan's/PostPile.app/Contents/Resources/postpile-mcp" } as const;
    expect(mcpServerCommand(moved)).toBe(`'/Users/alice/My Apps/Rowan'\\''s/PostPile.app/Contents/Resources/postpile-mcp'`);
    expect(mcpAddCommand(moved)).toBe(`claude mcp add --scope user postpile -- ${mcpServerCommand(moved)}`);
  });
});

describe('mcpServerMissing', () => {
  it('knows both wordings of "no such server"', () => {
    expect(mcpServerMissing('No MCP server named "postpile". Configured servers: grafana')).toBe(true);
    expect(mcpServerMissing('No MCP server found with name: postpile')).toBe(true);
    expect(mcpServerMissing('Error: connect ETIMEDOUT')).toBe(false);
  });
});

describe('claudeCanManageMcp', () => {
  it('needs claude found and logged in, a usage limit is fine', () => {
    expect(claudeCanManageMcp('ok')).toBe(true);
    expect(claudeCanManageMcp('limited')).toBe(true);
    expect(claudeCanManageMcp('missing')).toBe(false);
    expect(claudeCanManageMcp('logged_out')).toBe(false);
    expect(claudeCanManageMcp('unchecked')).toBe(false);
  });
});
