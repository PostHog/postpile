import { accessSync, constants, statSync } from 'node:fs';
import {
  claudeBlocksAgent,
  claudeFailure,
  claudeHasAuthStatus,
  claudeLoggedIn,
  claudeRetryAtMs,
  claudeStatus,
  findTool,
  ghBlocksSync,
  ghStateFromFailure,
  ghStatus,
  recheckDelayMs,
  type ClaudeFailure,
  type ClaudeState,
  type GhFailure,
  type GhState,
  type ToolsView,
} from '@postpile/core';
import type { CommandRunner } from '../setup/setup-checks.ts';

export interface ToolHealthDeps {
  /** Runs gh and claude without a shell. */
  commands: CommandRunner;
  now: () => Date;
  /** The PATH programs are looked up in. Defaults to process.env.PATH, which the desktop app extends at launch. */
  path?: () => string;
  isExecutable?: (file: string) => boolean;
  /** Defaults to POSTPILE_CLAUDE_BIN, else "claude". */
  claudeBinary?: string;
  /** Called before each check, so the next GitHub call reads a fresh token from gh. */
  forgetToken?: () => void;
  /** State changes only, never every call. Defaults to console.log. */
  log?: (line: string) => void;
  /** A tool moved into a broken state (never on recovery back to ok). For the tool_missing telemetry event. */
  onBroken?: (tool: 'gh' | 'claude', state: BrokenToolState) => void;
}

/** GhState/ClaudeState with 'ok' and 'unchecked' excluded: what onBroken actually ever reports. */
export type BrokenToolState = Exclude<GhState, 'ok' | 'unchecked'> | Exclude<ClaudeState, 'ok' | 'unchecked'>;

interface ToolRecord<State> {
  state: State;
  path: string | null;
  version: string;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

/** A regular file this process may run. */
export function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The code of a thrown error, or of its cause (fetch wraps network errors in "fetch failed"). */
export function failureOf(error: unknown): GhFailure {
  const withCode = error as { code?: unknown; cause?: { code?: unknown }; status?: unknown; message?: unknown } | null;
  const code = typeof withCode?.code === 'string' ? withCode.code : typeof withCode?.cause?.code === 'string' ? withCode.cause.code : null;
  const status = typeof withCode?.status === 'number' ? withCode.status : null;
  const message = error instanceof Error ? error.message : String(error);
  return { code, status, message };
}

/**
 * gh and claude, checked once and then only when something is wrong, on a
 * backoff (1 minute doubling to 30). Everything that needs a tool asks here
 * first: a sync or poll does not start without gh, an agent call does not
 * start without claude, so a missing tool costs no process spawns and no
 * log lines per call. Real calls report back (a 401, a usage limit, a
 * missing binary), and a working call clears a runtime problem again.
 */
export class ToolHealth {
  private gh: ToolRecord<GhState> = { state: 'unchecked', path: null, version: '' };
  private claude: ToolRecord<ClaudeState> = { state: 'unchecked', path: null, version: '' };
  private claudeRetryAtMs: number | null = null;
  private checkedAtMs: number | null = null;
  private nextCheckAtMs: number | null = null;
  private failedChecks = 0;
  private checking: Promise<ToolsView> | null = null;
  private readonly log: (line: string) => void;
  private readonly claudeBinary: string;

  constructor(private readonly deps: ToolHealthDeps) {
    this.log = deps.log ?? ((line) => console.log(line));
    this.claudeBinary = deps.claudeBinary ?? (process.env.POSTPILE_CLAUDE_BIN || 'claude');
  }

  /** For wiring without real tools (tests, the read-only CLI): every check answers ok, nothing runs. */
  static assumeOk(now: () => Date): ToolHealth {
    return new ToolHealth({
      commands: async (_command, args) => ({ ok: true, missing: false, stdout: args.includes('token') ? 'token\n' : '', stderr: '' }),
      now,
      path: () => '/assumed',
      isExecutable: () => true,
      claudeBinary: 'claude',
      log: () => {},
    });
  }

  private nowMs(): number {
    return this.deps.now().getTime();
  }

  private iso(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
  }

  private setGh(next: ToolRecord<GhState>): void {
    if (next.state !== this.gh.state) {
      this.log(`tools: gh ${this.gh.state} -> ${next.state}`);
      if (next.state !== 'ok' && next.state !== 'unchecked') {
        this.deps.onBroken?.('gh', next.state);
      }
    }
    this.gh = next;
  }

  private setClaude(next: ToolRecord<ClaudeState>): void {
    if (next.state !== this.claude.state) {
      this.log(`tools: claude ${this.claude.state} -> ${next.state}`);
      if (next.state !== 'ok' && next.state !== 'unchecked') {
        this.deps.onBroken?.('claude', next.state);
      }
    }
    this.claude = next;
  }

  /** A limit whose time is up counts as lifted; the next call finds out. */
  private expireLimit(): void {
    if (this.claude.state === 'limited' && this.claudeRetryAtMs !== null && this.nowMs() >= this.claudeRetryAtMs) {
      this.claudeRetryAtMs = null;
      this.setClaude({ ...this.claude, state: 'ok' });
    }
  }

  /**
   * Something needs a fix from outside (install, login): look again later, a
   * little later each time. A check that finds everything fine does not reset
   * the backoff; only a real call that works does (an expired token looks
   * fine to `gh auth token` and is refused again by GitHub).
   */
  private scheduleRecheck(): void {
    const broken = ghBlocksSync(this.gh.state) || this.claude.state === 'missing' || this.claude.state === 'logged_out';
    if (broken) {
      this.failedChecks += 1;
      this.nextCheckAtMs = this.nowMs() + recheckDelayMs(this.failedChecks);
    } else {
      this.nextCheckAtMs = null;
    }
  }

  view(): ToolsView {
    this.expireLimit();
    return {
      gh: ghStatus(this.gh.state, this.gh.path, this.gh.version),
      claude: claudeStatus(this.claude.state, this.claude.path, this.claude.version, this.iso(this.claudeRetryAtMs)),
      canSync: !ghBlocksSync(this.gh.state),
      agentOn: !claudeBlocksAgent(this.claude.state),
      checkedAt: this.iso(this.checkedAtMs),
      nextCheckAt: this.iso(this.nextCheckAtMs),
    };
  }

  private checkDue(): boolean {
    return this.checkedAtMs === null || (this.nextCheckAtMs !== null && this.nowMs() >= this.nextCheckAtMs);
  }

  /** Checks now ("Check again", setup). A check while one runs joins it. */
  check(): Promise<ToolsView> {
    if (!this.checking) {
      this.checking = this.runCheck().finally(() => {
        this.checking = null;
      });
    }
    return this.checking;
  }

  /** A check when none ran yet or the backoff says it is time; the current view otherwise. */
  async ensureFresh(): Promise<ToolsView> {
    return this.checkDue() ? this.check() : this.view();
  }

  /** Starts a due check in the background, for callers that must not wait (the poll, the agent gate). */
  recheckIfDue(): void {
    if (this.checkDue()) {
      void this.check().catch(() => {});
    }
  }

  /** The gh headline while a sync would only fail; null when gh is usable. */
  ghOffReason(): string | null {
    return ghBlocksSync(this.gh.state) ? ghStatus(this.gh.state, this.gh.path).headline : null;
  }

  /** The claude headline while the agent is off ("Agent features are off: claude not found"); null when it is on. */
  agentOffReason(): string | null {
    this.expireLimit();
    return claudeBlocksAgent(this.claude.state) ? claudeStatus(this.claude.state, this.claude.path).headline : null;
  }

  /** A GitHub call or token read failed. Only failures that say something about gh change the state. */
  noteGhFailure(failure: GhFailure): void {
    const state = ghStateFromFailure(failure);
    if (state === null) {
      return;
    }
    const wasBlocking = ghBlocksSync(this.gh.state);
    this.setGh({ ...this.gh, state });
    if (ghBlocksSync(state) && !wasBlocking) {
      this.scheduleRecheck();
    }
  }

  /** GitHub answered: offline or rejected are over. */
  noteGhWorked(): void {
    if (this.gh.state !== 'ok') {
      this.setGh({ ...this.gh, state: 'ok' });
      this.failedChecks = 0;
      this.scheduleRecheck();
    }
  }

  /** A claude call failed. Returns what it meant for the tool, null for an ordinary failure. */
  noteClaudeFailure(message: string): ClaudeFailure | null {
    const failure = claudeFailure(message);
    if (failure === null) {
      return null;
    }
    const wasOff = claudeBlocksAgent(this.claude.state);
    this.claudeRetryAtMs = failure.state === 'limited' ? claudeRetryAtMs(failure, this.nowMs()) : null;
    this.setClaude({ ...this.claude, state: failure.state });
    if (!wasOff) {
      // Once per change: the raw message says more than the state.
      this.log(`tools: claude call failed: ${message.slice(0, 300)}`);
      this.scheduleRecheck();
    }
    return failure;
  }

  noteClaudeWorked(): void {
    if (this.claude.state !== 'ok') {
      this.claudeRetryAtMs = null;
      this.setClaude({ ...this.claude, state: 'ok' });
      this.failedChecks = 0;
      this.scheduleRecheck();
    }
  }

  private find(name: string): string | null {
    const path = this.deps.path?.() ?? process.env.PATH ?? '';
    return findTool(name, path, this.deps.isExecutable ?? isExecutableFile);
  }

  private async checkGh(): Promise<ToolRecord<GhState>> {
    const path = this.find('gh');
    if (!path) {
      return { state: 'missing', path: null, version: '' };
    }
    const version = await this.deps.commands(path, ['--version']);
    if (version.missing) {
      return { state: 'missing', path: null, version: '' };
    }
    const token = await this.deps.commands(path, ['auth', 'token']);
    if (!token.ok || token.stdout.trim() === '') {
      return { state: 'logged_out', path, version: firstLine(version.stdout) };
    }
    return { state: 'ok', path, version: firstLine(version.stdout) };
  }

  private async checkClaude(): Promise<ToolRecord<ClaudeState>> {
    const path = this.find(this.claudeBinary);
    if (!path) {
      return { state: 'missing', path: null, version: '' };
    }
    const version = await this.deps.commands(path, ['--version']);
    if (version.missing) {
      return { state: 'missing', path: null, version: '' };
    }
    const versionLine = firstLine(version.stdout);
    if (claudeHasAuthStatus(versionLine)) {
      const auth = await this.deps.commands(path, ['auth', 'status', '--json']);
      if (claudeLoggedIn(auth.stdout) === false) {
        return { state: 'logged_out', path, version: versionLine };
      }
    }
    // A usage limit is not visible from here; it holds until its time is up.
    const limited = this.claude.state === 'limited' && this.claudeRetryAtMs !== null && this.nowMs() < this.claudeRetryAtMs;
    return { state: limited ? 'limited' : 'ok', path, version: versionLine };
  }

  private async runCheck(): Promise<ToolsView> {
    this.deps.forgetToken?.();
    const [gh, claude] = await Promise.all([this.checkGh(), this.checkClaude()]);
    this.setGh(gh);
    if (claude.state !== 'limited') {
      this.claudeRetryAtMs = null;
    }
    this.setClaude(claude);
    this.checkedAtMs = this.nowMs();
    this.scheduleRecheck();
    return this.view();
  }
}
