import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentRequest, AgentResponse } from '@postpile/agent';
import type { CommandResult, CommandRunner } from '../setup/setup-checks.ts';
import { UserConfigFile } from '../user-config.ts';
import { ConcurrencyLimiter } from '@postpile/agent';
import { makeHarness } from '../testing/fakes.ts';
import { ClaudeAccountRunner, type SlotRunner, type SpawnOn } from './account-runner.ts';
import { ClaudeAccounts } from './claude-accounts.ts';
import { GatedRunner } from './gated-runner.ts';
import { ToolHealth } from './tool-health.ts';

const HOME = '/Users/alice';
const WORK = '/Users/alice/.claude-work';
const START = new Date(2026, 10, 20, 10, 0).getTime();
const request: AgentRequest = { purpose: 'chat', model: 'sonnet', prompt: 'hi', timeoutMs: 1000 };

class Clock {
  ms = START;
  readonly now = (): Date => new Date(this.ms);
}

/** `claude auth status --json` per account, told apart by CLAUDE_CONFIG_DIR. */
function authCommands(logins: Record<string, object | null>): { run: CommandRunner; envs: (string | undefined)[] } {
  const envs: (string | undefined)[] = [];
  const run: CommandRunner = async (_command, args, options): Promise<CommandResult> => {
    if (args[0] === '--version') {
      return { ok: true, missing: false, stdout: '2.1.0 (Claude Code)\n', stderr: '' };
    }
    const dir = options?.env?.CLAUDE_CONFIG_DIR;
    envs.push(dir);
    const login = logins[dir ?? 'default'] ?? null;
    return { ok: true, missing: false, stdout: JSON.stringify(login ?? { loggedIn: false }), stderr: '' };
  };
  return { run, envs };
}

const ACME = { loggedIn: true, orgName: 'Acme', subscriptionType: 'team', email: 'alice@acme.example' };
const PERSONAL = { loggedIn: true, orgName: "alice@example.com's Organization", subscriptionType: 'max', email: 'alice@example.com' };

function makeAccounts(options: { logins?: Record<string, object | null>; config?: UserConfigFile | null; env?: NodeJS.ProcessEnv } = {}) {
  const clock = new Clock();
  const log: string[] = [];
  const commands = authCommands(options.logins ?? { default: PERSONAL, [WORK]: ACME });
  const accounts = new ClaudeAccounts({
    commands: commands.run,
    userConfig: options.config ?? null,
    home: HOME,
    now: clock.now,
    env: options.env ?? {},
    homeConfigDirs: () => ['.claude-work'],
    claudeBinary: 'claude',
    log: (line) => log.push(line),
  });
  return { accounts, clock, log, commands };
}

/**
 * Answers per config folder: an error message, or a reply. One slot at a
 * time like a real limiter of 1; `gate` holds the first call open until the
 * test lets it go, so a second call can queue behind it.
 */
class FakeCli implements SlotRunner {
  readonly calls: (string | null | undefined)[] = [];
  private readonly limiter = new ConcurrencyLimiter(1);
  gate: Promise<void> = Promise.resolve();
  constructor(private readonly answers: Record<string, string>) {}

  private async answer(key: string | null | undefined): Promise<AgentResponse> {
    this.calls.push(key);
    await this.gate;
    const answer = this.answers[key ?? 'default'] ?? 'ok';
    if (answer.startsWith('error:')) {
      throw new Error(answer.slice('error:'.length));
    }
    return { text: answer, model: 'sonnet', durationMs: 1, costUsd: null };
  }

  runInSlot(_request: AgentRequest, task: (spawnOn: SpawnOn) => Promise<AgentResponse>): Promise<AgentResponse> {
    return this.limiter.run(() => task((configDir) => this.answer(configDir)));
  }
}

const LIMIT = "error:claude exited with 1: {\"is_error\":true,\"api_error_status\":429,\"result\":\"You've hit your limit · resets 3pm\"}";

describe('ClaudeAccounts discovery', () => {
  it('asks each folder with its own CLAUDE_CONFIG_DIR, the default with it unset', async () => {
    const { accounts, commands } = makeAccounts({ env: { CLAUDE_CONFIG_DIR: WORK } });
    await accounts.ensureDiscovered();
    expect(commands.envs.sort()).toEqual([WORK, undefined].sort());
    expect(accounts.view().accounts.map((account) => [account.label, account.preferred, account.inUse])).toEqual([
      ['Personal · max', true, true],
      ['Acme · team', false, false],
    ]);
  });

  it('keeps only logged-in accounts', async () => {
    const { accounts } = makeAccounts({ logins: { default: null, [WORK]: ACME } });
    await accounts.ensureDiscovered();
    expect(accounts.view().accounts.map((account) => account.id)).toEqual([WORK]);
  });

  it('runs on the app environment as before when nothing is found', async () => {
    const { accounts } = makeAccounts({ logins: {} });
    const cli = new FakeCli({});
    await new ClaudeAccountRunner(cli, accounts).run(request);
    expect(cli.calls).toEqual([undefined]);
    expect(accounts.view().accounts).toEqual([]);
  });

  it('keeps listed folders that are not logged in right now when saving a pick', async () => {
    const config = new UserConfigFile(join(mkdtempSync(join(tmpdir(), 'postpile-accounts-')), 'config.json'), () => {});
    config.setClaudeAccounts(['~/.claude-gone', 'default', WORK]);
    const { accounts } = makeAccounts({ config });
    await accounts.setPreferred(WORK);
    expect(config.read().claudeAccounts).toEqual([WORK, 'default', '/Users/alice/.claude-gone']);
  });

  it('drops token variables for picked accounts, also for auth status, and keeps them for the app environment', async () => {
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', HOME };
    const seen: NodeJS.ProcessEnv[] = [];
    const accounts = new ClaudeAccounts({
      commands: async (_command, args, options) => {
        if (options?.env) {
          seen.push(options.env);
        }
        return { ok: true, missing: false, stdout: args[0] === '--version' ? '2.1.0' : JSON.stringify(PERSONAL), stderr: '' };
      },
      userConfig: null,
      home: HOME,
      now: () => new Date(START),
      env,
      homeConfigDirs: () => [],
      log: () => {},
    });
    await accounts.ensureDiscovered();
    expect(seen.length).toBeGreaterThan(0);
    for (const childEnv of seen) {
      expect([childEnv.ANTHROPIC_API_KEY, childEnv.ANTHROPIC_AUTH_TOKEN, childEnv.CLAUDE_CODE_OAUTH_TOKEN]).toEqual([undefined, undefined, undefined]);
    }
    expect(accounts.envFor(WORK).ANTHROPIC_API_KEY).toBeUndefined();
    expect(accounts.envFor('app-env').ANTHROPIC_API_KEY).toBe('k');
  });

  it('saves the preferred account first in config.json', async () => {
    const config = new UserConfigFile(join(mkdtempSync(join(tmpdir(), 'postpile-accounts-')), 'config.json'), () => {});
    const { accounts } = makeAccounts({ config });
    await accounts.setPreferred(WORK);
    expect(config.read().claudeAccounts).toEqual([WORK, 'default']);
    expect(accounts.view().accounts[0]).toMatchObject({ id: WORK, preferred: true, inUse: true });
    accounts.setFallback(false);
    expect(config.read().claudeFallback).toBe(false);
  });
});

describe('ClaudeAccountRunner', () => {
  it('sends a call that queued behind a limit straight to the next account', async () => {
    const { accounts } = makeAccounts();
    const cli = new FakeCli({ default: LIMIT, [WORK]: 'from work' });
    let release = (): void => {};
    cli.gate = new Promise((resolve) => (release = resolve));
    const runner = new ClaudeAccountRunner(cli, accounts);

    const first = runner.run(request);
    const second = runner.run(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);

    // The queued call never tries the account the first one found at its limit.
    expect(cli.calls).toEqual([null, WORK, WORK]);
  });

  it('runs on the preferred account, CLAUDE_CONFIG_DIR unset for the default', async () => {
    const { accounts } = makeAccounts();
    const cli = new FakeCli({});
    await new ClaudeAccountRunner(cli, accounts).run(request);
    expect(cli.calls).toEqual([null]);
  });

  it('retries the same call on the next account at a usage limit, and stays there until the reset', async () => {
    const { accounts, clock, log } = makeAccounts();
    const cli = new FakeCli({ default: LIMIT, [WORK]: 'from work' });
    const runner = new ClaudeAccountRunner(cli, accounts);

    expect((await runner.run(request)).text).toBe('from work');
    expect(cli.calls).toEqual([null, WORK]);
    expect(log.some((line) => line.startsWith('claude account Personal · max at limit until') && line.endsWith('using Acme · team'))).toBe(true);
    expect(accounts.view().accounts[0]).toMatchObject({ inUse: false, limitedUntil: new Date(2026, 10, 20, 15, 0).toISOString() });

    await runner.run(request);
    expect(cli.calls).toEqual([null, WORK, WORK]);

    clock.ms = new Date(2026, 10, 20, 15, 0).getTime();
    await runner.run(request);
    // Tried again at its reset; still limited here, so on to the next one.
    expect(cli.calls.slice(3)).toEqual([null, WORK]);
  });

  it('lets the limit through with the soonest reset when every account is at its limit, and the gate pauses', async () => {
    const { accounts, clock } = makeAccounts();
    const cli = new FakeCli({ default: LIMIT, [WORK]: 'error:Claude AI usage limit reached|' + String(Math.floor((START + 60 * 60_000) / 1000)) });
    const health = ToolHealth.assumeOk(clock.now);
    const gated = new GatedRunner(new ClaudeAccountRunner(cli, accounts), health);

    await expect(gated.run(request)).rejects.toThrow('Agent features are paused');
    expect(cli.calls).toEqual([null, WORK]);
    expect(health.view().claude.retryAt).toBe(new Date(START + 60 * 60_000).toISOString());
  });

  it('does not fall back when fallback is off', async () => {
    const { accounts } = makeAccounts();
    accounts.setFallback(false);
    const cli = new FakeCli({ default: LIMIT });
    await expect(new ClaudeAccountRunner(cli, accounts).run(request)).rejects.toThrow('usage limit reached');
    expect(cli.calls).toEqual([null]);
  });

  it('keeps a limit another call noted while an earlier call on the account still ran', async () => {
    const { accounts } = makeAccounts();
    await accounts.ensureDiscovered();

    const markAtStart = accounts.limitMark('default');
    accounts.noteFailure('default', 'Claude AI usage limit reached');
    accounts.noteWorked('default', markAtStart);
    expect(accounts.pick()).toBe(WORK);

    // A call that started after the limit and worked does lift it.
    accounts.noteWorked('default', accounts.limitMark('default'));
    expect(accounts.pick()).toBe('default');
  });

  it('passes other failures through without marking the account', async () => {
    const { accounts } = makeAccounts();
    const cli = new FakeCli({ default: 'error:claude timed out after 1000ms (chat)' });
    await expect(new ClaudeAccountRunner(cli, accounts).run(request)).rejects.toThrow('timed out');
    expect(accounts.view().accounts[0]).toMatchObject({ inUse: true, limitedUntil: null });
  });
});

describe('ToolHealth with accounts', () => {
  it('lifts the agent pause when an account choice frees one', async () => {
    const { accounts } = makeAccounts();
    await accounts.ensureDiscovered();
    const { engine, tools } = makeHarness({ claudeAccounts: accounts });
    await engine.setClaudeFallback(false);
    accounts.noteFailure('default', 'Claude AI usage limit reached');
    tools.noteClaudeFailure('Claude AI usage limit reached');
    expect(tools.agentOffReason()).not.toBeNull();

    await engine.setClaudeFallback(true);
    expect(tools.agentOffReason()).toBeNull();
  });

  it('keeps the pause when the choice frees nothing', async () => {
    const { accounts } = makeAccounts();
    await accounts.ensureDiscovered();
    const { engine, tools } = makeHarness({ claudeAccounts: accounts });
    accounts.noteFailure('default', 'Claude AI usage limit reached');
    accounts.noteFailure(WORK, 'Claude AI usage limit reached');
    tools.noteClaudeFailure('Claude AI usage limit reached');

    await engine.setPreferredClaudeAccount(WORK);
    expect(tools.agentOffReason()).not.toBeNull();
  });

  it('checks the login of the account in use', async () => {
    const { accounts, commands } = makeAccounts();
    const clock = new Clock();
    const runCommand: CommandRunner = async (command, args, options) => {
      if (command.endsWith('gh')) {
        return { ok: true, missing: false, stdout: args.includes('token') ? 'token\n' : 'gh version 1.0\n', stderr: '' };
      }
      return commands.run(command, args, options);
    };
    const health = new ToolHealth({ commands: runCommand, now: clock.now, path: () => '/usr/bin', isExecutable: () => true, claudeBinary: 'claude', log: () => {}, claudeAccounts: accounts });
    await accounts.setPreferred(WORK);
    commands.envs.length = 0;
    const view = await health.check();
    expect(view.claude.state).toBe('ok');
    // The refresh asks both; the check itself asks the account in use.
    expect(commands.envs.at(-1)).toBe(WORK);
  });
});
