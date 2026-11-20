import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProcessEnv } from '@postpile/agent';
import {
  claudeAccountCandidates,
  claudeAccountLabel,
  claudeAccountLimited,
  claudeAccountOrder,
  claudeAccountShortLabel,
  claudeFailure,
  claudeHasAuthStatus,
  claudeRetryAtMs,
  DEFAULT_CLAUDE_ACCOUNT,
  normalizeClaudeAccountId,
  parseClaudeAuthStatus,
  pickClaudeAccount,
  preferClaudeAccount,
  type ClaudeAccountsView,
  type ClaudeAuthStatus,
} from '@postpile/core';
import type { CommandRunner } from '../setup/setup-checks.ts';
import type { UserConfigFile } from '../user-config.ts';

/**
 * Used while no account was found (claude missing, too old for `auth status`,
 * nothing logged in): calls run with the app's own environment, as before
 * accounts existed. Never a folder path, so it cannot clash with one.
 */
const APP_ENV_ACCOUNT = 'app-env';

/** The `.claude-*` folders in `home` that hold a login file. */
function homeConfigDirs(home: string): string[] {
  try {
    return readdirSync(home).filter((name) => name.startsWith('.claude-') && existsSync(join(home, name, '.claude.json')));
  } catch {
    return [];
  }
}

export interface ClaudeAccountsDeps {
  /** Runs `claude auth status --json` with each account's environment. */
  commands: CommandRunner;
  /** Where the order and the fallback switch live. Null: kept in memory only (tests). */
  userConfig: UserConfigFile | null;
  home: string;
  now: () => Date;
  /** The app's own environment. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to the `.claude-*` folders in home with a `.claude.json`. */
  homeConfigDirs?: () => string[];
  /** Defaults to POSTPILE_CLAUDE_BIN, else "claude". */
  claudeBinary?: string;
  /** State changes only. Defaults to console.log. */
  log?: (line: string) => void;
}

interface FoundAccount {
  id: string;
  status: ClaudeAuthStatus;
}

/**
 * The Claude accounts agent calls can run on (DESIGN.md "Claude accounts").
 * Finds the logged-in ones once and again on each tools check or menu open,
 * keeps which are at their usage limit (in memory, until their reset), and
 * answers which account a call runs on now. The order and the fallback
 * switch live in config.json, read on use.
 */
export class ClaudeAccounts {
  private found: FoundAccount[] = [];
  private discoveredOnce = false;
  private discovering: Promise<void> | null = null;
  private readonly limitedUntil = new Map<string, number>();
  private memoryOrder: string[] = [];
  private memoryFallback = true;
  private readonly env: NodeJS.ProcessEnv;
  private readonly claudeBinary: string;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: ClaudeAccountsDeps) {
    this.env = deps.env ?? process.env;
    this.claudeBinary = deps.claudeBinary ?? (this.env.POSTPILE_CLAUDE_BIN || 'claude');
    this.log = deps.log ?? ((line) => console.log(line));
  }

  private nowMs(): number {
    return this.deps.now().getTime();
  }

  /** The configured order, normalized; the in-memory one without a config file. */
  private configuredOrder(): string[] {
    if (!this.deps.userConfig) {
      return this.memoryOrder;
    }
    return (this.deps.userConfig.read().claudeAccounts ?? []).map((entry) => normalizeClaudeAccountId(entry, this.deps.home));
  }

  private fallback(): boolean {
    if (!this.deps.userConfig) {
      return this.memoryFallback;
    }
    return this.deps.userConfig.read().claudeFallback ?? true;
  }

  /** The environment a claude process for this account runs with. */
  envFor(id: string): NodeJS.ProcessEnv {
    if (id === APP_ENV_ACCOUNT) {
      return claudeProcessEnv(this.env, undefined);
    }
    return claudeProcessEnv(this.env, id === DEFAULT_CLAUDE_ACCOUNT ? null : id);
  }

  /** The CLAUDE_CONFIG_DIR a call on this account sets: null for the default, undefined for the app's own environment. */
  configDirOf(id: string): string | null | undefined {
    if (id === APP_ENV_ACCOUNT) {
      return undefined;
    }
    return id === DEFAULT_CLAUDE_ACCOUNT ? null : id;
  }

  private label(id: string): string {
    if (id === APP_ENV_ACCOUNT) {
      return 'from the app environment';
    }
    return claudeAccountLabel(id, this.found.find((account) => account.id === id)?.status ?? null);
  }

  private async discover(): Promise<void> {
    const version = await this.deps.commands(this.claudeBinary, ['--version']);
    // A 1.x claude would take "auth status" as a prompt.
    if (!version.ok || !claudeHasAuthStatus(version.stdout.trim())) {
      this.found = [];
      return;
    }
    const candidates = claudeAccountCandidates({
      home: this.deps.home,
      homeConfigDirs: (this.deps.homeConfigDirs ?? (() => homeConfigDirs(this.deps.home)))(),
      envConfigDir: this.env.CLAUDE_CONFIG_DIR,
      configured: this.configuredOrder(),
    });
    const answers = await Promise.all(
      candidates.map(async (id) => {
        const result = await this.deps.commands(this.claudeBinary, ['auth', 'status', '--json'], { env: this.envFor(id) });
        return { id, status: parseClaudeAuthStatus(result.stdout) };
      }),
    );
    const before = this.found.map((account) => account.id).join(', ');
    this.found = answers.flatMap(({ id, status }) => (status?.loggedIn ? [{ id, status }] : []));
    const after = this.found.map((account) => account.id).join(', ');
    if (after !== before) {
      this.log(`claude accounts: ${this.found.length === 0 ? 'none logged in' : this.found.map((account) => this.label(account.id)).join(', ')}`);
    }
  }

  /** Looks for logged-in accounts again (tools check, menu open). A refresh while one runs joins it. */
  refresh(): Promise<void> {
    if (!this.discovering) {
      this.discovering = this.discover()
        .catch((error: unknown) => this.log(`claude accounts: could not look for accounts: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          this.discoveredOnce = true;
          this.discovering = null;
        });
    }
    return this.discovering;
  }

  /** Discovery once, before the first call. */
  async ensureDiscovered(): Promise<void> {
    if (!this.discoveredOnce) {
      await this.refresh();
    }
  }

  /** The accounts calls try, in order. Nothing found: the app's own environment alone. */
  private callOrder(): string[] {
    if (this.found.length === 0) {
      return [APP_ENV_ACCOUNT];
    }
    return claudeAccountOrder(
      this.found.map((account) => account.id),
      this.configuredOrder(),
    );
  }

  /** A limit whose time is up is lifted; the next call finds out whether it really is. */
  private expireLimits(): void {
    const now = this.nowMs();
    for (const [id, until] of this.limitedUntil) {
      if (!claudeAccountLimited(until, now)) {
        this.limitedUntil.delete(id);
        this.log(`claude account ${this.label(id)} is past its limit, back in use`);
      }
    }
  }

  /** The account a call runs on now; null when every account it may use is at its limit. */
  pick(): string | null {
    this.expireLimits();
    return pickClaudeAccount(this.callOrder(), this.limitedUntil, this.nowMs(), this.fallback());
  }

  /**
   * A call on `id` failed. A usage limit marks the account limited until its
   * reset (or a fixed pause) and returns true: the caller tries the next one.
   */
  noteFailure(id: string, message: string): boolean {
    const failure = claudeFailure(message, this.nowMs());
    if (failure?.state !== 'limited') {
      return false;
    }
    const wasLimited = this.limitedUntil.has(id);
    const until = Math.max(claudeRetryAtMs(failure, this.nowMs()), this.limitedUntil.get(id) ?? 0);
    this.limitedUntil.set(id, until);
    if (!wasLimited) {
      const next = this.pick();
      const using = next === null ? 'no other account to use' : `using ${this.label(next)}`;
      this.log(`claude account ${this.label(id)} at limit until ${new Date(until).toISOString()}, ${using}`);
    }
    return true;
  }

  /** A call on `id` worked: whatever limit was noted for it is over. */
  noteWorked(id: string): void {
    if (this.limitedUntil.delete(id)) {
      this.log(`claude account ${this.label(id)} works again`);
    }
  }

  /** The soonest time an account calls may use is free again; null when none is limited. */
  soonestFreeMs(): number | null {
    const order = this.callOrder();
    const usable = this.fallback() ? order : order.slice(0, 1);
    const times = usable
      .map((id) => this.limitedUntil.get(id))
      .filter((until): until is number => until !== undefined);
    return times.length === 0 ? null : Math.min(...times);
  }

  /** The environment for checking claude (`auth status`): the account in use, else the preferred one. */
  async checkEnv(): Promise<NodeJS.ProcessEnv> {
    await this.ensureDiscovered();
    return this.envFor(this.pick() ?? this.callOrder()[0] ?? APP_ENV_ACCOUNT);
  }

  view(): ClaudeAccountsView {
    const inUse = this.pick();
    const accounts = this.callOrder()
      .filter((id) => id !== APP_ENV_ACCOUNT)
      .map((id, index) => {
        const status = this.found.find((account) => account.id === id)?.status ?? null;
        const until = this.limitedUntil.get(id);
        return {
          id,
          label: claudeAccountLabel(id, status),
          shortLabel: claudeAccountShortLabel(id, status),
          email: status?.email ?? null,
          configDir: id === DEFAULT_CLAUDE_ACCOUNT ? null : id,
          preferred: index === 0,
          inUse: id === inUse,
          limitedUntil: until === undefined ? null : new Date(until).toISOString(),
        };
      });
    return { accounts, fallback: this.fallback() };
  }

  /** Makes `id` the preferred account: first in the saved order. */
  async setPreferred(id: string): Promise<ClaudeAccountsView> {
    await this.ensureDiscovered();
    const order = this.callOrder();
    if (!order.includes(id)) {
      throw new Error(`no logged-in Claude account ${id}`);
    }
    // Listed accounts not logged in right now (a login that expired) keep
    // their place in the file, after the found ones, so they count again later.
    const found = preferClaudeAccount(order, id);
    const notFound = this.configuredOrder().filter((entry) => !found.includes(entry));
    const next = [...found, ...notFound];
    if (this.deps.userConfig) {
      this.deps.userConfig.setClaudeAccounts(next);
    } else {
      this.memoryOrder = next;
    }
    this.log(`claude accounts: ${this.label(id)} preferred`);
    return this.view();
  }

  setFallback(on: boolean): ClaudeAccountsView {
    if (this.deps.userConfig) {
      this.deps.userConfig.setClaudeFallback(on);
    } else {
      this.memoryFallback = on;
    }
    this.log(`claude accounts: fallback ${on ? 'on' : 'off'}`);
    return this.view();
  }
}
