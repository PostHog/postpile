import { describe, expect, it } from 'vitest';
import {
  AGENT_OFF_MARK,
  CLAUDE_LIMIT_PAUSE_MS,
  claudeBlocksAgent,
  claudeFailure,
  claudeHasAuthStatus,
  claudeLoggedIn,
  claudeRetryAtMs,
  claudeStatus,
  extendedPath,
  findTool,
  ghBlocksSync,
  ghStateFromFailure,
  ghStatus,
  recheckDelayMs,
  splitAgentOffErrors,
  TOOL_FIXES,
  TOOL_RECHECK_MAX_MS,
} from './tools.ts';

describe('extendedPath', () => {
  it('appends the folders a Finder launch misses, once each', () => {
    expect(extendedPath('/usr/bin:/bin:/opt/homebrew/bin', '/Users/alice')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/alice/.local/bin:/Users/alice/.claude/local',
    );
  });

  it('works from an empty PATH and drops empty parts', () => {
    expect(extendedPath('::', '/h').split(':')).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/h/.local/bin', '/h/.claude/local']);
  });
});

describe('findTool', () => {
  const files = new Set(['/opt/homebrew/bin/gh', '/Users/alice/.local/bin/claude']);
  const isExecutable = (file: string) => files.has(file);

  it('takes the first PATH folder that has the program', () => {
    expect(findTool('gh', '/usr/bin:/opt/homebrew/bin/', isExecutable)).toBe('/opt/homebrew/bin/gh');
    expect(findTool('claude', '/usr/bin::/Users/alice/.local/bin', isExecutable)).toBe('/Users/alice/.local/bin/claude');
  });

  it('answers null when no folder has it', () => {
    expect(findTool('gh', '/usr/bin:/bin', isExecutable)).toBeNull();
  });

  it('checks an explicit path as is', () => {
    expect(findTool('/Users/alice/.local/bin/claude', '', isExecutable)).toBe('/Users/alice/.local/bin/claude');
    expect(findTool('/nope/claude', '/Users/alice/.local/bin', isExecutable)).toBeNull();
  });
});

describe('recheckDelayMs', () => {
  it('starts at a minute and doubles up to 30 minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(recheckDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, TOOL_RECHECK_MAX_MS, TOOL_RECHECK_MAX_MS, TOOL_RECHECK_MAX_MS]);
    expect(recheckDelayMs(0)).toBe(60_000);
  });
});

describe('ghStateFromFailure', () => {
  it('maps a missing binary, no login, a 401 and network trouble', () => {
    expect(ghStateFromFailure({ code: 'ENOENT', message: 'spawn gh ENOENT' })).toBe('missing');
    expect(ghStateFromFailure({ code: 'GH_LOGGED_OUT', message: 'gh has no login' })).toBe('logged_out');
    expect(ghStateFromFailure({ message: 'no oauth token found for github.com' })).toBe('logged_out');
    expect(ghStateFromFailure({ status: 401, message: 'GitHub GET notifications failed with 401: Bad credentials' })).toBe('rejected');
    expect(ghStateFromFailure({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.github.com' })).toBe('offline');
    expect(ghStateFromFailure({ message: 'fetch failed' })).toBe('offline');
  });

  it('leaves other failures alone', () => {
    expect(ghStateFromFailure({ status: 502, message: 'GitHub POST graphql failed with 502' })).toBeNull();
    expect(ghStateFromFailure({ status: 403, message: 'Resource not accessible by integration' })).toBeNull();
  });
});

describe('claudeFailure', () => {
  it('spots a missing binary', () => {
    expect(claudeFailure('could not start claude: spawn claude ENOENT')).toEqual({ state: 'missing', resetAtMs: null });
  });

  it('spots a missing login in the CLI wordings', () => {
    for (const message of [
      'claude returned an error: {"is_error":true,"result":"Invalid API key · Please run /login"}',
      'claude exited with 1: Not logged in · Please run /login',
      'claude exited with 1: OAuth token has expired. Please obtain a new token',
    ]) {
      expect(claudeFailure(message)?.state).toBe('logged_out');
    }
  });

  it('spots usage and rate limits, with the reset time when the CLI gives one', () => {
    expect(claudeFailure('claude exited with 1: Claude AI usage limit reached|1790000000')).toEqual({ state: 'limited', resetAtMs: 1_790_000_000_000 });
    expect(claudeFailure('claude returned an error: {"result":"5-hour limit reached ∙ resets 3pm"}')).toEqual({ state: 'limited', resetAtMs: null });
    expect(claudeFailure("claude exited with 1: You've hit your limit · resets 4pm")?.state).toBe('limited');
    expect(claudeFailure('claude exited with 1: API Error: 429 {"type":"rate_limit_error"}')?.state).toBe('limited');
  });

  it('leaves ordinary failures alone', () => {
    expect(claudeFailure('claude timed out after 60000ms (ping_decision)')).toBeNull();
    expect(claudeFailure('claude exited with 1: something broke')).toBeNull();
  });
});

describe('claudeRetryAtMs', () => {
  const now = 1_000_000_000_000;
  it('waits for the reset time, at least a minute', () => {
    expect(claudeRetryAtMs({ state: 'limited', resetAtMs: now + 3_600_000 }, now)).toBe(now + 3_600_000);
    expect(claudeRetryAtMs({ state: 'limited', resetAtMs: now - 5 }, now)).toBe(now + 60_000);
  });

  it('pauses a fixed while without one', () => {
    expect(claudeRetryAtMs({ state: 'limited', resetAtMs: null }, now)).toBe(now + CLAUDE_LIMIT_PAUSE_MS);
  });
});

describe('claude auth status', () => {
  it('is only asked from version 2 on', () => {
    expect(claudeHasAuthStatus('2.1.4 (Claude Code)')).toBe(true);
    expect(claudeHasAuthStatus('1.0.98 (Claude Code)')).toBe(false);
    expect(claudeHasAuthStatus('')).toBe(false);
  });

  it('reads loggedIn from the JSON, null for anything else', () => {
    expect(claudeLoggedIn('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(claudeLoggedIn('{"loggedIn": false}')).toBe(false);
    expect(claudeLoggedIn('Logged in as alice')).toBeNull();
    expect(claudeLoggedIn('{}')).toBeNull();
  });
});

describe('status words', () => {
  it('gives gh the exact install and login commands', () => {
    const missing = ghStatus('missing', null);
    expect(missing.headline).toBe('GitHub CLI (gh) not found');
    expect(missing.fixes.map((fix) => fix.command)).toEqual([TOOL_FIXES.installGh, TOOL_FIXES.ghLogin]);
    expect(ghStatus('rejected', '/opt/homebrew/bin/gh').fixes.map((fix) => fix.command)).toEqual(['gh auth login']);
    expect(ghStatus('ok', '/opt/homebrew/bin/gh', 'gh version 2.60.0').detail).toBe('Found at /opt/homebrew/bin/gh. gh version 2.60.0');
  });

  it('says plainly that the agent is off and the rules carry on', () => {
    const missing = claudeStatus('missing', null);
    expect(missing.headline).toBe('Agent features are off: claude not found');
    expect(missing.detail).toContain('still work on rules');
    expect(missing.fixes.map((fix) => fix.command)).toEqual([TOOL_FIXES.installClaude, TOOL_FIXES.claudeLogin]);
    expect(claudeStatus('limited', '/x/claude', '', '2026-09-28T15:00:00.000Z').retryAt).toBe('2026-09-28T15:00:00.000Z');
    expect(claudeStatus('ok', '/x/claude', '', '2026-09-28T15:00:00.000Z').retryAt).toBeNull();
  });

  it('starts every agent-off headline with the mark', () => {
    for (const state of ['missing', 'logged_out', 'limited'] as const) {
      expect(claudeStatus(state, null).headline.startsWith(AGENT_OFF_MARK)).toBe(true);
    }
  });
});

describe('blocking rules', () => {
  it('blocks a sync only for gh states a retry cannot fix by itself', () => {
    expect((['ok', 'unchecked', 'offline'] as const).map(ghBlocksSync)).toEqual([false, false, false]);
    expect((['missing', 'logged_out', 'rejected'] as const).map(ghBlocksSync)).toEqual([true, true, true]);
  });

  it('turns the agent off for missing, logged out and limited', () => {
    expect((['ok', 'unchecked'] as const).map(claudeBlocksAgent)).toEqual([false, false]);
    expect((['missing', 'logged_out', 'limited'] as const).map(claudeBlocksAgent)).toEqual([true, true, true]);
  });
});

describe('splitAgentOffErrors', () => {
  it('drops the lines that only repeat the agent being off', () => {
    const result = splitAgentOffErrors(['glance acme/app#1: Agent features are off: claude not found', 'fetch: GitHub 502', 'dossier t1: Agent features are off: claude not found']);
    expect(result).toEqual({ errors: ['fetch: GitHub 502'], agentOff: true });
    expect(splitAgentOffErrors(['fetch: GitHub 502'])).toEqual({ errors: ['fetch: GitHub 502'], agentOff: false });
  });
});
