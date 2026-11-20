import type { IsoTime } from './types.ts';

// Several Claude subscriptions on one Mac, each logged in under its own
// claude config folder (DESIGN.md "Claude accounts"). An account is one such
// folder, or the default: CLAUDE_CONFIG_DIR unset, which is not the same as
// setting it to ~/.claude. Agent calls run on the first account in the
// user's order that is not at its usage limit. These are the wire types and
// the pure rules: which folders to ask, what order they go in, which one a
// call runs on, and what the footer says.

/** The id of the account with CLAUDE_CONFIG_DIR unset. Every other id is a folder path. */
export const DEFAULT_CLAUDE_ACCOUNT = 'default';

/** What `claude auth status --json` says about one login. */
export interface ClaudeAuthStatus {
  loggedIn: boolean;
  orgName: string | null;
  /** "max", "pro", "team", ... */
  subscriptionType: string | null;
  email: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `claude auth status --json`, or null when the output is not the expected JSON. */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthStatus | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.loggedIn !== 'boolean') {
    return null;
  }
  return {
    loggedIn: parsed.loggedIn,
    orgName: textOrNull(parsed.orgName),
    subscriptionType: textOrNull(parsed.subscriptionType),
    email: textOrNull(parsed.email),
  };
}

/** "default" stays as is, "~/x" points into the home folder, a trailing slash is dropped. */
export function normalizeClaudeAccountId(entry: string, home: string): string {
  const trimmed = entry.trim();
  if (trimmed === DEFAULT_CLAUDE_ACCOUNT) {
    return trimmed;
  }
  const expanded = trimmed === '~' ? home : trimmed.startsWith('~/') ? `${home}/${trimmed.slice(2)}` : trimmed;
  return expanded.length > 1 ? expanded.replace(/\/+$/, '') : expanded;
}

export interface ClaudeAccountCandidateParts {
  home: string;
  /** Names of the `.claude-*` folders in the home folder that hold a `.claude.json`. */
  homeConfigDirs: string[];
  /** CLAUDE_CONFIG_DIR of the app's own environment, when set. */
  envConfigDir: string | undefined;
  /** `claudeAccounts` from config.json. */
  configured: string[];
}

/**
 * The accounts worth asking `claude auth status` about, in discovery order:
 * the default, every `~/.claude-*` folder with a login file (by name), the
 * app's own CLAUDE_CONFIG_DIR, then folders only config.json lists.
 */
export function claudeAccountCandidates(parts: ClaudeAccountCandidateParts): string[] {
  const homeDirs = parts.homeConfigDirs
    .filter((name) => name.startsWith('.claude-'))
    .sort()
    .map((name) => `${parts.home}/${name}`);
  const env = parts.envConfigDir ? [parts.envConfigDir] : [];
  const all = [DEFAULT_CLAUDE_ACCOUNT, ...homeDirs, ...env, ...parts.configured].map((entry) => normalizeClaudeAccountId(entry, parts.home));
  return [...new Set(all.filter((id) => id !== ''))];
}

/**
 * The logged-in accounts in the order calls try them: the ones config.json
 * lists first, in its order, then the rest in discovery order. Without a
 * list the default goes first, so a single-account setup runs as before.
 */
export function claudeAccountOrder(found: string[], configured: string[]): string[] {
  const listed = configured.filter((id, index) => found.includes(id) && configured.indexOf(id) === index);
  return [...listed, ...found.filter((id) => !listed.includes(id))];
}

/** The order with `id` moved to the front: the new preferred account. */
export function preferClaudeAccount(order: string[], id: string): string[] {
  return [id, ...order.filter((other) => other !== id)];
}

/** True while an account is at its limit. */
export function claudeAccountLimited(limitedUntilMs: number | undefined, nowMs: number): boolean {
  return limitedUntilMs !== undefined && nowMs < limitedUntilMs;
}

/**
 * The account a call runs on now: the first in order that is not at its
 * limit. With fallback off only the preferred one counts. Null when none is
 * free; then the call fails with the limit and the agent pauses.
 */
export function pickClaudeAccount(order: string[], limitedUntilMs: ReadonlyMap<string, number>, nowMs: number, fallback: boolean): string | null {
  const choices = fallback ? order : order.slice(0, 1);
  return choices.find((id) => !claudeAccountLimited(limitedUntilMs.get(id), nowMs)) ?? null;
}

/** The last part of a folder path: "/Users/alice/.claude-work" -> ".claude-work". */
function folderName(id: string): string {
  return id.split('/').filter((part) => part !== '').pop() ?? id;
}

/**
 * The short name in the footer: the org ("Acme"), "Personal" for the
 * organization claude.ai makes for one person ("alice@example.com's
 * Organization"), else the folder name.
 */
export function claudeAccountShortLabel(id: string, status: ClaudeAuthStatus | null): string {
  const org = status?.orgName ?? null;
  if (org !== null && /'s Organi[sz]ation$/i.test(org)) {
    return 'Personal';
  }
  if (org !== null) {
    return org;
  }
  return id === DEFAULT_CLAUDE_ACCOUNT ? 'Default' : folderName(id);
}

/** The menu's name for an account: "Acme · team". */
export function claudeAccountLabel(id: string, status: ClaudeAuthStatus | null): string {
  const short = claudeAccountShortLabel(id, status);
  return status?.subscriptionType ? `${short} · ${status.subscriptionType}` : short;
}

/** One logged-in account in the footer menu. */
export interface ClaudeAccountView {
  /** "default" or the config folder. */
  id: string;
  /** "Acme · team". */
  label: string;
  /** "Acme". */
  shortLabel: string;
  email: string | null;
  /** The config folder, null for the default. Shown as a hint. */
  configDir: string | null;
  /** First in order. */
  preferred: boolean;
  /** The account the next call runs on. */
  inUse: boolean;
  /** When the account is tried again; null when it is not at its limit. */
  limitedUntil: IsoTime | null;
}

/** GET /api/claude-accounts. In call order, the preferred one first. */
export interface ClaudeAccountsView {
  accounts: ClaudeAccountView[];
  /** "When it hits its limit, use the next account". */
  fallback: boolean;
}
