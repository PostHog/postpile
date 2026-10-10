import type { IsoTime } from './types.ts';

// The two outside programs PostPile needs (DESIGN.md "Missing tools"): gh for
// every GitHub read and write, claude for every agent call. The engine checks
// them once, keeps a typed status and backs off; these are the wire types and
// the pure rules: how a failure maps to a state, what the app says about it,
// and when it looks again.

/**
 * ok: works. missing: not on PATH. logged_out: `gh auth token` gave nothing.
 * rejected: GitHub answered 401 to the token (expired or revoked).
 * offline: GitHub could not be reached. unchecked: not looked at yet.
 */
export type GhState = 'ok' | 'missing' | 'logged_out' | 'rejected' | 'offline' | 'unchecked';

/**
 * ok: works. missing: not on PATH. logged_out: `claude auth status` or a call
 * said so. limited: a usage or rate limit; the agent pauses until retryAt.
 * unchecked: not looked at yet.
 */
export type ClaudeState = 'ok' | 'missing' | 'logged_out' | 'limited' | 'unchecked';

/** One step of a fix: a label and, when there is one, the exact command to run in a terminal. */
export interface ToolFix {
  label: string;
  command: string | null;
}

export interface ToolStatus<State extends string> {
  state: State;
  /** Where the program was found on PATH. Null when missing or not checked. */
  path: string | null;
  /** One calm line, e.g. "Agent features are off: claude not found". */
  headline: string;
  /** What it means for the app, in a sentence or two. */
  detail: string;
  /** In order. Empty when there is nothing to run (ok, offline, limited). */
  fixes: ToolFix[];
  /** limited: when the agent is tried again. Null otherwise. */
  retryAt: IsoTime | null;
}

/** GET /api/tools. */
export interface ToolsView {
  gh: ToolStatus<GhState>;
  claude: ToolStatus<ClaudeState>;
  /** False when gh is missing, logged out or rejected: a sync would only fail. */
  canSync: boolean;
  /** False when claude is missing, logged out or limited: the app runs on rules only. */
  agentOn: boolean;
  checkedAt: IsoTime | null;
  /** When the engine looks again by itself while something is wrong. Null when all is well. */
  nextCheckAt: IsoTime | null;
}

/** The exact commands the app offers. Setup's check screen uses the same ones. */
export const TOOL_FIXES = {
  installGh: 'brew install gh',
  ghLogin: 'gh auth login',
  notificationsScope: 'gh auth refresh -h github.com -s notifications',
  installClaude: 'curl -fsSL https://claude.ai/install.sh | bash',
  claudeLogin: 'claude auth login',
};

/**
 * Said whenever gh or claude is not found. The app no longer reads PATH from
 * the login shell, so a tool that only a shell setup puts on PATH (mise, asdf,
 * nix) needs its folder listed here.
 */
export const TOOL_PATH_HINT =
  'Installed somewhere else, e.g. through mise or asdf? Add that folder to "toolPath" in ~/.config/postpile/config.json and restart PostPile.';

/** Every claude headline starts with this, so agent-off errors can be told apart from real ones. */
export const AGENT_OFF_MARK = 'Agent features are ';

/** First look again after a failed check; doubles per failed check up to the max. */
export const TOOL_RECHECK_MIN_MS = 60_000;
export const TOOL_RECHECK_MAX_MS = 30 * 60_000;
/** A usage limit without a reset time pauses the agent this long. */
export const CLAUDE_LIMIT_PAUSE_MS = 30 * 60_000;

/** Folders a GUI launch misses: Homebrew (Apple silicon and Intel), the native Claude Code installer, the old local install. */
export function extraToolDirs(home: string): string[] {
  return ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.claude/local`];
}

/** PATH with the extra folders appended when missing. Order kept, no duplicates, empty parts dropped. */
export function extendedPath(path: string, home: string, delimiter = ':'): string {
  const parts = path.split(delimiter).filter((part) => part !== '');
  const extra = extraToolDirs(home).filter((dir) => !parts.includes(dir));
  return [...new Set([...parts, ...extra])].join(delimiter);
}

/** The folders in /etc/paths or a file in /etc/paths.d: one per line, blank lines and # comments dropped. */
export function etcPathsEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** "~/x" and "~" point into the home folder; other entries stay as they are. */
function expandHome(dir: string, home: string): string {
  if (dir === '~') {
    return home;
  }
  return dir.startsWith('~/') ? `${home}/${dir.slice(2)}` : dir;
}

export interface ToolSearchPathParts {
  /** toolPath from config.json: the user's own folders (mise or asdf shims, a custom install). First, so they win. */
  toolPath: string[];
  /** The PATH the app started with. A GUI launch gets launchd's short one. */
  envPath: string;
  /** Folders from /etc/paths and /etc/paths.d, what path_helper adds for a login shell. */
  systemDirs: string[];
  home: string;
}

/**
 * The PATH gh and claude are looked up in, built without running a shell.
 * Running the login shell ($SHELL -ilc) made every tool in the user's zsh
 * setup run with PostPile as the responsible process, so macOS asked for
 * privacy permissions on its behalf. Order: toolPath, the start PATH, the
 * system folders, then extraToolDirs. No duplicates, empty parts dropped.
 */
export function toolSearchPath(parts: ToolSearchPathParts, delimiter = ':'): string {
  const toolPath = parts.toolPath.map((dir) => expandHome(dir, parts.home));
  const joined = [...toolPath, parts.envPath, ...parts.systemDirs].join(delimiter);
  return extendedPath(joined, parts.home, delimiter);
}

/**
 * Where `name` runs from: an explicit path (with a "/") is checked as is,
 * otherwise the first PATH folder that has it as an executable. Null when
 * nothing matches, which means "missing" without starting a process.
 */
export function findTool(name: string, path: string, isExecutable: (file: string) => boolean, delimiter = ':'): string | null {
  if (name.includes('/')) {
    return isExecutable(name) ? name : null;
  }
  for (const dir of path.split(delimiter)) {
    if (dir === '') {
      continue;
    }
    const file = `${dir.replace(/\/+$/, '')}/${name}`;
    if (isExecutable(file)) {
      return file;
    }
  }
  return null;
}

/** Wait before the next check after `failedChecks` failed ones in a row (1 or more). */
export function recheckDelayMs(failedChecks: number): number {
  const steps = Math.max(failedChecks, 1) - 1;
  return Math.min(TOOL_RECHECK_MIN_MS * 2 ** steps, TOOL_RECHECK_MAX_MS);
}

/** What a failed gh step looked like: the error code, an HTTP status, the message. */
export interface GhFailure {
  code?: string | null;
  status?: number | null;
  message: string;
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

/** The gh state a failure means, or null when it is some other problem (a 500, a bad query). */
export function ghStateFromFailure(failure: GhFailure): GhState | null {
  if (failure.code === 'ENOENT') {
    return 'missing';
  }
  if (failure.code === 'GH_LOGGED_OUT' || /no oauth token|gh auth login|not logged in/i.test(failure.message)) {
    return 'logged_out';
  }
  if (failure.status === 401) {
    return 'rejected';
  }
  if ((failure.code && NETWORK_CODES.has(failure.code)) || /fetch failed|getaddrinfo|network/i.test(failure.message)) {
    return 'offline';
  }
  return null;
}

export interface ClaudeFailure {
  state: 'missing' | 'logged_out' | 'limited';
  /** limited: when the limit resets, as epoch ms. Null when claude did not say. */
  resetAtMs: number | null;
}

/**
 * The claude state a failed call means, or null when it is an ordinary
 * failure (timeout, bad JSON, a model error) that says nothing about the
 * tool. Matches the CLI's own wording; unknown text stays an ordinary failure.
 */
export function claudeFailure(message: string): ClaudeFailure | null {
  if (/could not start .*ENOENT|spawn \S+ ENOENT/i.test(message)) {
    return { state: 'missing', resetAtMs: null };
  }
  if (/please run \/login|not logged in|invalid api key|oauth token (has )?expired|authentication_error/i.test(message)) {
    return { state: 'logged_out', resetAtMs: null };
  }
  if (/usage limit|limit reached|hit your limit|rate_limit_error|rate limit/i.test(message)) {
    // Older CLIs print "Claude AI usage limit reached|<epoch seconds>".
    const epoch = /limit reached\|(\d{10})/i.exec(message)?.[1];
    return { state: 'limited', resetAtMs: epoch ? Number(epoch) * 1000 : null };
  }
  return null;
}

/** When a limited agent is tried again: the reset time when claude said one (at least a minute out), else a fixed pause. */
export function claudeRetryAtMs(failure: ClaudeFailure, nowMs: number): number {
  if (failure.resetAtMs !== null) {
    return Math.max(failure.resetAtMs, nowMs + 60_000);
  }
  return nowMs + CLAUDE_LIMIT_PAUSE_MS;
}

/** `claude --version` prints "2.1.4 (Claude Code)"; `claude auth status` exists from 2.x on. Older ones would take it as a prompt. */
export function claudeHasAuthStatus(versionOutput: string): boolean {
  const major = Number(/^\s*(\d+)\./.exec(versionOutput)?.[1] ?? '0');
  return major >= 2;
}

/** `claude auth status --json` -> loggedIn. Null when the output is not the expected JSON (then the calls themselves will tell). */
export function claudeLoggedIn(authStatusOutput: string): boolean | null {
  try {
    const parsed = JSON.parse(authStatusOutput) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : null;
  } catch {
    return null;
  }
}

function found(path: string | null): string {
  return path ? `Found at ${path}.` : '';
}

/** The words and fixes for a gh state. */
export function ghStatus(state: GhState, path: string | null, version = ''): ToolStatus<GhState> {
  const base = { state, path, retryAt: null };
  switch (state) {
    case 'ok':
      return { ...base, headline: 'GitHub CLI ready', detail: [found(path), version].filter(Boolean).join(' '), fixes: [] };
    case 'missing':
      return {
        ...base,
        headline: 'GitHub CLI (gh) not found',
        detail: `PostPile reads GitHub through gh, so nothing can sync until it is installed and logged in. ${TOOL_PATH_HINT}`,
        fixes: [
          { label: 'Install it', command: TOOL_FIXES.installGh },
          { label: 'Log in', command: TOOL_FIXES.ghLogin },
        ],
      };
    case 'logged_out':
      return {
        ...base,
        headline: 'gh is not logged in',
        detail: `${found(path)} PostPile reads GitHub with the login from gh, so nothing can sync until gh has one.`.trim(),
        fixes: [{ label: 'Log in', command: TOOL_FIXES.ghLogin }],
      };
    case 'rejected':
      return {
        ...base,
        headline: 'GitHub did not accept the gh login',
        detail: 'The token from gh auth token was refused, most likely expired or revoked. Syncing waits until gh has a fresh login.',
        fixes: [{ label: 'Log in again', command: TOOL_FIXES.ghLogin }],
      };
    case 'offline':
      return { ...base, headline: 'GitHub cannot be reached', detail: 'No network, or GitHub is having trouble. The app tries again by itself.', fixes: [] };
    case 'unchecked':
      return { ...base, headline: 'GitHub CLI not checked yet', detail: '', fixes: [] };
  }
}

/** The words and fixes for a claude state. */
export function claudeStatus(state: ClaudeState, path: string | null, version = '', retryAt: IsoTime | null = null): ToolStatus<ClaudeState> {
  const rulesOnly = 'Tiles, whose turn and notifications still work on rules. Topics, dossiers and glances stop updating and chat is off until the Claude Code CLI works.';
  const base = { state, path, retryAt: null };
  switch (state) {
    case 'ok':
      return { ...base, headline: 'Claude Code CLI ready', detail: [found(path), version].filter(Boolean).join(' '), fixes: [] };
    case 'missing':
      return {
        ...base,
        headline: `${AGENT_OFF_MARK}off: claude not found`,
        detail: `${rulesOnly} ${TOOL_PATH_HINT}`,
        fixes: [
          { label: 'Install Claude Code', command: TOOL_FIXES.installClaude },
          { label: 'Log in', command: TOOL_FIXES.claudeLogin },
        ],
      };
    case 'logged_out':
      return {
        ...base,
        headline: `${AGENT_OFF_MARK}off: claude is not logged in`,
        detail: `${found(path)} ${rulesOnly}`.trim(),
        fixes: [{ label: 'Log in', command: TOOL_FIXES.claudeLogin }],
      };
    case 'limited':
      return {
        ...base,
        retryAt,
        headline: `${AGENT_OFF_MARK}paused: Claude usage limit reached`,
        detail: 'Rules carry on meanwhile. The agent is tried again when the limit resets.',
        fixes: [],
      };
    case 'unchecked':
      return { ...base, headline: 'Claude Code CLI not checked yet', detail: '', fixes: [] };
  }
}

/** gh states that make a sync pointless. Offline is left to the poll's own backoff. */
export function ghBlocksSync(state: GhState): boolean {
  return state === 'missing' || state === 'logged_out' || state === 'rejected';
}

/** claude states that turn the agent off. Unchecked counts as on: the first call finds out. */
export function claudeBlocksAgent(state: ClaudeState): boolean {
  return state === 'missing' || state === 'logged_out' || state === 'limited';
}

/**
 * Errors that only repeat "the agent is off" drop out of a report; the report
 * says it once instead. Returns the other errors and whether any dropped.
 */
export function splitAgentOffErrors(errors: string[]): { errors: string[]; agentOff: boolean } {
  const kept = errors.filter((error) => !error.includes(AGENT_OFF_MARK));
  return { errors: kept, agentOff: kept.length !== errors.length };
}
