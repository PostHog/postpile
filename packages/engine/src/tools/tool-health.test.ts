import { describe, expect, it } from 'vitest';
import { FakeRunner } from '@postpile/agent';
import { FakeCommands } from '../testing/fakes.ts';
import { AgentOffError, GatedRunner } from './gated-runner.ts';
import { ToolHealth } from './tool-health.ts';
import { GhOffError, WatchedTokenSource, watchedFetch } from './watched-github.ts';

const START = Date.parse('2026-09-02T12:00:00Z');
const MINUTE = 60_000;

class Clock {
  ms = START;
  readonly now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

function makeHealth(options: { forgetToken?: () => void } = {}) {
  const commands = new FakeCommands();
  const clock = new Clock();
  const log: string[] = [];
  const health = new ToolHealth({
    commands: commands.run,
    now: clock.now,
    path: () => '/usr/bin:/opt/homebrew/bin',
    isExecutable: commands.isExecutable,
    claudeBinary: 'claude',
    forgetToken: options.forgetToken,
    log: (line) => log.push(line),
  });
  return { health, commands, clock, log };
}

const request = { purpose: 'chat' as const, model: 'sonnet', prompt: 'hi', timeoutMs: 1000 };

describe('ToolHealth checks', () => {
  it('checks once on the first ask and names where each tool was found', async () => {
    const { health, commands } = makeHealth();

    const view = await health.ensureFresh();
    await health.ensureFresh();

    expect(view).toMatchObject({ canSync: true, agentOn: true, nextCheckAt: null, gh: { state: 'ok', path: '/usr/bin/gh' }, claude: { state: 'ok', path: '/usr/bin/claude' } });
    expect(view.gh.detail).toBe('Found at /usr/bin/gh. gh version 1.0');
    expect(commands.calls).toEqual(['gh --version', 'claude --version', 'gh auth token']);
  });

  it('reports a missing gh without starting it, and looks again on a doubling backoff', async () => {
    const { health, commands, clock } = makeHealth();
    commands.missing.add('gh');

    const view = await health.ensureFresh();
    expect(view).toMatchObject({ canSync: false, gh: { state: 'missing', headline: 'GitHub CLI (gh) not found' } });
    expect(view.nextCheckAt).toBe(new Date(START + MINUTE).toISOString());
    expect(commands.calls.filter((call) => call.startsWith('gh'))).toEqual([]);

    const callsBefore = commands.calls.length;
    clock.advance(30_000);
    await health.ensureFresh();
    expect(commands.calls.length).toBe(callsBefore);

    clock.advance(30_000);
    const again = await health.ensureFresh();
    expect(commands.calls.length).toBeGreaterThan(callsBefore);
    expect(again.nextCheckAt).toBe(new Date(clock.ms + 2 * MINUTE).toISOString());
  });

  it('picks up a fixed tool on "Check again" and asks for a fresh token', async () => {
    let forgotten = 0;
    const { health, commands } = makeHealth({ forgetToken: () => (forgotten += 1) });
    commands.failing.add('gh auth token');
    expect((await health.ensureFresh()).gh).toMatchObject({ state: 'logged_out', headline: 'gh is not logged in' });

    commands.failing.clear();
    const view = await health.check();

    expect(view).toMatchObject({ canSync: true, gh: { state: 'ok' }, nextCheckAt: null });
    expect(forgotten).toBe(2);
  });

  it('asks claude auth status from version 2 on and turns the agent off without a login', async () => {
    const { health, commands } = makeHealth();
    commands.answers.set('claude --version', '2.1.4 (Claude Code)\n');
    commands.answers.set('claude auth status --json', '{"loggedIn": false}');

    const view = await health.ensureFresh();

    expect(view).toMatchObject({ agentOn: false, canSync: true, claude: { state: 'logged_out', headline: 'Agent features are off: claude is not logged in' } });
    expect(health.agentOffReason()).toBe('Agent features are off: claude is not logged in');
  });

  it('logs state changes only', async () => {
    const { health, commands, log } = makeHealth();
    commands.missing.add('claude');
    await health.ensureFresh();
    await health.check();
    await health.check();

    expect(log).toEqual(['tools: gh unchecked -> ok', 'tools: claude unchecked -> missing']);
  });
});

describe('ToolHealth runtime reports', () => {
  it('pauses the agent until a usage limit resets, then lets calls through again', async () => {
    const { health, clock } = makeHealth();
    await health.ensureFresh();
    const resetSeconds = Math.floor((START + 90 * MINUTE) / 1000);

    health.noteClaudeFailure(`claude exited with 1: Claude AI usage limit reached|${resetSeconds}`);

    expect(health.view()).toMatchObject({ agentOn: false, claude: { state: 'limited', retryAt: new Date(resetSeconds * 1000).toISOString() } });
    // A check cannot see the limit; it holds until its time.
    await health.check();
    expect(health.agentOffReason()).toBe('Agent features are paused: Claude usage limit reached');
    clock.advance(91 * MINUTE);
    expect(health.agentOffReason()).toBeNull();
  });

  it('ignores ordinary claude failures', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();
    expect(health.noteClaudeFailure('claude timed out after 1000ms (chat)')).toBeNull();
    expect(health.view().agentOn).toBe(true);
  });

  it('blocks syncing on a 401 until GitHub answers again; offline does not block', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();

    health.noteGhFailure({ code: 'ENOTFOUND', message: 'fetch failed' });
    expect(health.view()).toMatchObject({ canSync: true, gh: { state: 'offline' } });

    health.noteGhFailure({ status: 401, message: 'Bad credentials' });
    expect(health.ghOffReason()).toBe('GitHub did not accept the gh login');

    health.noteGhWorked();
    expect(health.view()).toMatchObject({ canSync: true, gh: { state: 'ok' } });
  });
});

describe('GatedRunner', () => {
  it('turns a missing claude into one AgentOffError and then stops starting processes', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();
    let starts = 0;
    const gated = new GatedRunner(
      {
        run: async () => {
          starts += 1;
          throw new Error('could not start claude: spawn claude ENOENT');
        },
      },
      health,
    );

    await expect(gated.run(request)).rejects.toThrow(new AgentOffError('Agent features are off: claude not found'));
    await expect(gated.run(request)).rejects.toBeInstanceOf(AgentOffError);

    expect(starts).toBe(1);
    expect(health.view().agentOn).toBe(false);
  });

  it('passes ordinary failures through and clears the state on a working call', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();
    const runner = new FakeRunner();
    const gated = new GatedRunner(runner, health);

    await expect(gated.run(request)).rejects.toThrow('FakeRunner has no answer queued for chat');

    health.noteClaudeFailure('claude exited with 1: rate_limit_error');
    expect(health.view().agentOn).toBe(false);
    health.noteClaudeWorked();
    runner.answer('chat', 'hello');
    await expect(gated.run(request)).resolves.toMatchObject({ text: 'hello' });
  });
});

describe('watched GitHub', () => {
  it('does not run gh auth token while gh is known to be missing', async () => {
    const { health, commands } = makeHealth();
    commands.missing.add('gh');
    await health.ensureFresh();
    let reads = 0;
    const tokens = new WatchedTokenSource({ token: async () => `t${(reads += 1)}` }, health);

    await expect(tokens.token()).rejects.toThrow(new GhOffError('GitHub CLI (gh) not found'));
    expect(reads).toBe(0);
  });

  it('reports what a failed token read meant', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();
    const failing = new WatchedTokenSource(
      {
        token: async () => {
          throw Object.assign(new Error('gh has no login'), { code: 'GH_LOGGED_OUT' });
        },
      },
      health,
    );

    await expect(failing.token()).rejects.toThrow('gh has no login');
    expect(health.view().gh.state).toBe('logged_out');
  });

  it('tells the status about 401s, network failures and answers that worked', async () => {
    const { health } = makeHealth();
    await health.ensureFresh();
    const answers: (Response | Error)[] = [
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } }),
      new Response('{}', { status: 401 }),
      new Response('{}', { status: 200 }),
    ];
    const fetchFn = watchedFetch(health, async () => {
      const next = answers.shift()!;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    });

    await expect(fetchFn('https://api.github.com/user', {})).rejects.toThrow('fetch failed');
    expect(health.view().gh.state).toBe('offline');
    await fetchFn('https://api.github.com/user', {});
    expect(health.view().gh.state).toBe('rejected');
    await fetchFn('https://api.github.com/user', {});
    expect(health.view().gh.state).toBe('ok');
  });
});
