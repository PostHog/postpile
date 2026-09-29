import {
  claudeCanManageMcp,
  mcpAddArgs,
  mcpAddCommand,
  MCP_SERVER_NAME,
  mcpServerCommand,
  mcpServerMissing,
  type ActionResult,
  type McpConnectFrom,
  type McpConnectionState,
  type McpConnectionView,
  type McpLauncher,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { failed, ok } from './actions/results.ts';
import type { CommandRunner } from './setup/setup-checks.ts';
import type { Telemetry } from './telemetry/telemetry.ts';
import type { ToolHealth } from './tools/tool-health.ts';

/** Set by "Not now" in the footer; the footer item stays away for good. */
const HIDDEN_KEY = 'mcp_connect_hidden_at';
/** `claude mcp get` spawns a process (and a health check of the server): at most once per this. */
const CHECK_EVERY_MS = 5 * 60 * 1000;

export interface McpConnectionDeps {
  store: Store;
  /** Runs claude in the app's own empty folder, like every other gh and claude call. */
  commands: CommandRunner;
  /** Where claude is and whether it is logged in; nothing runs while it is not. */
  tools: ToolHealth;
  /** Null (CLI, standalone server, tests): nothing is ever run, the command is only shown. */
  launcher: McpLauncher | null;
  now: () => Date;
  telemetry: Telemetry;
  log?: (line: string) => void;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

/**
 * Whether Claude Code has PostPile's MCP server (`claude mcp get postpile`,
 * cached for a few minutes), and "Add to Claude Code" (`claude mcp add
 * --scope user`), which only runs from a click and only in the installed
 * app. A dev build and a missing or logged-out claude never run anything;
 * the state stays unknown there, so the footer does not ask.
 */
export class McpConnection {
  private state: McpConnectionState = 'unknown';
  private error: string | null = null;
  private checkedAtMs: number | null = null;
  private checking: Promise<void> | null = null;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: McpConnectionDeps) {
    this.log = deps.log ?? ((line) => console.log(line));
  }

  /** Why the app cannot run claude for this now; null when it can. Checks the tools when that is due. */
  private async blockedReason(): Promise<string | null> {
    const launcher = this.deps.launcher;
    if (launcher === null) {
      return 'Only the installed app adds it by itself. Run the command in a terminal.';
    }
    if (launcher.kind === 'dev') {
      return 'A dev build does not add it by itself. Run the command in a terminal.';
    }
    const tools = await this.deps.tools.ensureFresh();
    return claudeCanManageMcp(tools.claude.state) ? null : `Needs claude: ${tools.claude.headline}`;
  }

  private claudePath(): string {
    return this.deps.tools.view().claude.path ?? (process.env.POSTPILE_CLAUDE_BIN || 'claude');
  }

  private async runCheck(): Promise<void> {
    const result = await this.deps.commands(this.claudePath(), ['mcp', 'get', MCP_SERVER_NAME]);
    this.checkedAtMs = this.deps.now().getTime();
    if (result.ok) {
      this.state = 'connected';
      this.error = null;
    } else if (mcpServerMissing(`${result.stdout}\n${result.stderr}`)) {
      this.state = 'not_connected';
      this.error = null;
    } else {
      // A timeout or an odd answer: better not to ask than to ask wrongly.
      const error = firstLine(result.stderr) || firstLine(result.stdout) || 'claude mcp get failed';
      if (error !== this.error) {
        this.log(`mcp connection: check failed: ${error}`);
      }
      this.state = 'unknown';
      this.error = error;
    }
  }

  /** A check while one runs joins it. */
  private check(): Promise<void> {
    if (!this.checking) {
      this.checking = this.runCheck().finally(() => {
        this.checking = null;
      });
    }
    return this.checking;
  }

  private checkDue(): boolean {
    return this.checkedAtMs === null || this.deps.now().getTime() - this.checkedAtMs >= CHECK_EVERY_MS;
  }

  private current(blockedReason: string | null): McpConnectionView {
    const launcher = this.deps.launcher;
    return {
      state: blockedReason === null ? this.state : 'unknown',
      blockedReason,
      addCommand: mcpAddCommand(launcher),
      serverCommand: mcpServerCommand(launcher),
      hidden: this.deps.store.meta.get(HIDDEN_KEY) !== null,
      checkedAt: this.checkedAtMs === null ? null : new Date(this.checkedAtMs).toISOString(),
      error: this.error,
    };
  }

  /** The last answer, checked again when it is older than a few minutes. */
  async view(): Promise<McpConnectionView> {
    const blockedReason = await this.blockedReason();
    if (blockedReason === null && this.checkDue()) {
      await this.check();
    }
    return this.current(blockedReason);
  }

  /** "Add to Claude Code". Checks again afterwards, so the answer is what Claude Code has now. */
  async connect(from: McpConnectFrom): Promise<ActionResult> {
    const blockedReason = await this.blockedReason();
    const launcher = this.deps.launcher;
    if (blockedReason !== null || launcher?.kind !== 'app') {
      this.deps.telemetry.capture('mcp_connect_clicked', { from, ok: false });
      return failed(blockedReason ?? 'Only the installed app adds it by itself.');
    }
    const result = await this.deps.commands(this.claudePath(), mcpAddArgs(launcher));
    await this.check();
    const connected = this.state === 'connected';
    this.deps.telemetry.capture('mcp_connect_clicked', { from, ok: connected });
    if (connected) {
      return ok('Added to Claude Code. New Claude Code sessions can ask PostPile.');
    }
    const error = firstLine(result.stderr) || firstLine(result.stdout) || this.error || 'no answer';
    this.log(`mcp connection: add failed: ${error}`);
    this.error = error;
    return failed(`Could not add it to Claude Code: ${error}`);
  }

  /** "Not now": the footer item stays away. Kept in meta. */
  hide(): ActionResult {
    this.deps.store.meta.set(HIDDEN_KEY, this.deps.now().toISOString());
    this.deps.telemetry.capture('mcp_connect_dismissed', {});
    return ok('Hidden. Setup still offers it when you run it again.');
  }
}
