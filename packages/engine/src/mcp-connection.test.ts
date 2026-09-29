import type { McpLauncher } from '@postpile/core';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { McpConnection } from './mcp-connection.ts';
import type { CommandResult, CommandRunner } from './setup/setup-checks.ts';
import { FakeCommands, FakeTelemetry, makeHarness, NOW } from './testing/fakes.ts';
import { ToolHealth } from './tools/tool-health.ts';

const APP_PATH = '/Applications/PostPile.app/Contents/Resources/postpile-mcp';
const APP: McpLauncher = { kind: 'app', path: APP_PATH };

/** Claude Code's MCP list as `claude mcp get` and `claude mcp add` see it. Never runs the real claude. */
class FakeClaudeMcp {
  readonly servers = new Set<string>();
  readonly calls: string[] = [];
  /** Answer for `claude mcp get` other than found / not found, e.g. a timeout. */
  getFails: CommandResult | null = null;
  addFails: string | null = null;

  readonly run: CommandRunner = async (command, args): Promise<CommandResult> => {
    this.calls.push([command.split('/').pop(), ...args].join(' '));
    const [, verb] = args;
    const name = verb === 'get' ? args[2] : args[args.indexOf('--') - 1];
    if (verb === 'get') {
      if (this.getFails) {
        return this.getFails;
      }
      return this.servers.has(name ?? '')
        ? { ok: true, missing: false, stdout: `${name}:\n  Scope: User config\n`, stderr: '' }
        : { ok: false, missing: false, stdout: '', stderr: `No MCP server named "${name}". Configured servers: grafana` };
    }
    if (this.addFails) {
      return { ok: false, missing: false, stdout: '', stderr: this.addFails };
    }
    this.servers.add(name ?? '');
    return { ok: true, missing: false, stdout: `Added stdio MCP server ${name}\n`, stderr: '' };
  };
}

function setup(options: { launcher?: McpLauncher | null; claude?: 'missing' | 'logged_out'; store?: Store } = {}) {
  let nowMs = NOW.getTime();
  const now = () => new Date(nowMs);
  const claude = new FakeClaudeMcp();
  const toolCommands = new FakeCommands();
  if (options.claude === 'missing') {
    toolCommands.missing.add('claude');
  }
  if (options.claude === 'logged_out') {
    toolCommands.answers.set('claude --version', '2.1.0 (Claude Code)\n');
    toolCommands.answers.set('claude auth status --json', '{"loggedIn":false}');
  }
  const tools = new ToolHealth({ commands: toolCommands.run, now, path: () => '/usr/bin', isExecutable: toolCommands.isExecutable, claudeBinary: 'claude', log: () => {} });
  const telemetry = new FakeTelemetry();
  const store = options.store ?? Store.open(':memory:');
  const mcp = new McpConnection({
    store,
    commands: claude.run,
    tools,
    launcher: options.launcher === undefined ? APP : options.launcher,
    now,
    telemetry,
    log: () => {},
  });
  return { mcp, claude, telemetry, store, advance: (ms: number) => (nowMs += ms) };
}

describe('McpConnection', () => {
  it('asks claude once and keeps the answer for a few minutes', async () => {
    const { mcp, claude, advance } = setup();

    expect(await mcp.view()).toMatchObject({ state: 'not_connected', blockedReason: null, hidden: false, error: null });
    await mcp.view();
    expect(claude.calls).toEqual(['claude mcp get postpile']);

    claude.servers.add('postpile');
    advance(4 * 60 * 1000);
    expect((await mcp.view()).state).toBe('not_connected');
    advance(60 * 1000);
    expect((await mcp.view()).state).toBe('connected');
    expect(claude.calls).toHaveLength(2);
  });

  it('shows the exact commands for the app launcher', async () => {
    const { mcp } = setup();
    const view = await mcp.view();
    expect(view.addCommand).toBe(`claude mcp add --scope user postpile -- ${APP_PATH}`);
    expect(view.serverCommand).toBe(APP_PATH);
  });

  it('adds it at user scope on a click, then checks again', async () => {
    const { mcp, claude, telemetry } = setup();
    await mcp.view();

    const result = await mcp.connect('footer');

    expect(result.ok).toBe(true);
    expect(claude.calls).toEqual([
      'claude mcp get postpile',
      `claude mcp add --scope user postpile -- ${APP_PATH}`,
      'claude mcp get postpile',
    ]);
    expect((await mcp.view()).state).toBe('connected');
    expect(telemetry.events).toEqual([{ event: 'mcp_connect_clicked', props: { from: 'footer', ok: true } }]);
  });

  it('counts "already exists" as done when claude has it afterwards', async () => {
    const { mcp, claude } = setup();
    claude.servers.add('postpile');
    claude.addFails = 'MCP server postpile already exists in user config';
    expect((await mcp.connect('setup')).ok).toBe(true);
  });

  it('reports a failed add with claude’s words', async () => {
    const { mcp, claude, telemetry } = setup();
    claude.addFails = 'Error: permission denied writing ~/.claude.json';

    const result = await mcp.connect('setup');

    expect(result).toMatchObject({ ok: false, message: 'Could not add it to Claude Code: Error: permission denied writing ~/.claude.json' });
    expect((await mcp.view()).state).toBe('not_connected');
    expect(telemetry.events).toEqual([{ event: 'mcp_connect_clicked', props: { from: 'setup', ok: false } }]);
  });

  it('does not ask on an odd answer (a timeout): the state stays unknown', async () => {
    const { mcp, claude } = setup();
    claude.getFails = { ok: false, missing: false, stdout: '', stderr: 'Error: timed out' };
    expect(await mcp.view()).toMatchObject({ state: 'unknown', error: 'Error: timed out' });
  });

  it('runs nothing in a dev build and only shows the dev command', async () => {
    const { mcp, claude, telemetry } = setup({ launcher: { kind: 'dev', repoRoot: '/src/postpile' } });

    const view = await mcp.view();
    const result = await mcp.connect('setup');

    expect(view).toMatchObject({ state: 'unknown', addCommand: 'claude mcp add postpile -e POSTPILE_PROFILE=default -- pnpm -C /src/postpile cli mcp' });
    expect(view.blockedReason).toMatch(/dev build/);
    expect(result.ok).toBe(false);
    expect(claude.calls).toEqual([]);
    expect(telemetry.events).toEqual([{ event: 'mcp_connect_clicked', props: { from: 'setup', ok: false } }]);
  });

  it('runs nothing without a launcher (CLI, standalone server)', async () => {
    const { mcp, claude } = setup({ launcher: null });
    expect(await mcp.view()).toMatchObject({ state: 'unknown', addCommand: 'claude mcp add postpile -- postpile-mcp', serverCommand: 'postpile-mcp' });
    expect(claude.calls).toEqual([]);
  });

  it.each(['missing', 'logged_out'] as const)('stays quiet while claude is %s', async (problem) => {
    const { mcp, claude } = setup({ claude: problem });

    const view = await mcp.view();

    expect(view.state).toBe('unknown');
    expect(view.blockedReason).toMatch(/^Needs claude: /);
    expect((await mcp.connect('footer')).ok).toBe(false);
    expect(claude.calls).toEqual([]);
  });

  it('keeps "Not now" in meta', async () => {
    const store = Store.open(':memory:');
    const first = setup({ store });
    expect(first.mcp.hide().ok).toBe(true);
    expect(first.telemetry.events).toEqual([{ event: 'mcp_connect_dismissed', props: {} }]);

    const again = setup({ store });
    expect((await again.mcp.view()).hidden).toBe(true);
  });
});

describe('Engine MCP connection', () => {
  it('uses the engine’s commands and tools, and never runs claude mcp without a launcher', async () => {
    const h = makeHarness();
    expect((await h.engine.mcpConnection()).state).toBe('unknown');
    expect(h.commands.calls.filter((line) => line.includes('mcp'))).toEqual([]);

    const withApp = makeHarness({ mcpLauncher: APP });
    expect((await withApp.engine.mcpConnection()).state).toBe('connected');
    expect(withApp.commands.calls).toContain('claude mcp get postpile');
    expect((await withApp.engine.hideMcpConnect()).ok).toBe(true);
    expect((await withApp.engine.mcpConnection()).hidden).toBe(true);
  });
});
