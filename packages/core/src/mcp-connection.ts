import type { ClaudeState } from './tools.ts';
import type { IsoTime } from './types.ts';

// Connecting PostPile's read-only MCP server to Claude Code: the footer and
// the last setup step offer "Add to Claude Code", which runs `claude mcp add`
// only on that click. These are the wire type and the pure rules: how
// Claude Code starts the server, and how to read `claude mcp get`.

/** The name the server is added under in Claude Code. */
export const MCP_SERVER_NAME = 'postpile';

/**
 * How Claude Code starts PostPile's MCP server. `app`: the launcher inside
 * the installed app (Contents/Resources/postpile-mcp), the only one the app
 * adds by itself. `dev`: the repo's `pnpm cli mcp`, shown as a command only.
 */
export type McpLauncher = { kind: 'app'; path: string } | { kind: 'dev'; repoRoot: string };

/** unknown: not checked (a dev build, claude missing or logged out) or the check failed. */
export type McpConnectionState = 'connected' | 'not_connected' | 'unknown';

/** Where "Add to Claude Code" was clicked. */
export type McpConnectFrom = 'footer' | 'setup';

/** GET /api/mcp-connection. */
export interface McpConnectionView {
  /** The footer only asks on not_connected. */
  state: McpConnectionState;
  /** Why "Add to Claude Code" cannot run here; null when it can. */
  blockedReason: string | null;
  /** The command the button runs, to run by hand instead. */
  addCommand: string;
  /** What any MCP client starts over stdio, for other agents. */
  serverCommand: string;
  /** "Not now" in the footer: the footer item stays away. Setup still offers it. */
  hidden: boolean;
  checkedAt: IsoTime | null;
  /** Why the last check or add failed; null when it worked. */
  error: string | null;
}

/** `claude mcp` works while claude is found and logged in; a usage limit does not matter for it. */
export function claudeCanManageMcp(state: ClaudeState): boolean {
  return state === 'ok' || state === 'limited';
}

/** `claude mcp get` said no server has that name (the wording changed between claude versions). */
export function mcpServerMissing(output: string): boolean {
  return /no mcp server (named|found)/i.test(output);
}

/** The arguments after `claude` that add the server. Without a launcher: the Homebrew command from the README. */
export function mcpAddArgs(launcher: McpLauncher | null): string[] {
  if (launcher?.kind === 'app') {
    return ['mcp', 'add', '--scope', 'user', MCP_SERVER_NAME, '--', launcher.path];
  }
  if (launcher?.kind === 'dev') {
    return ['mcp', 'add', MCP_SERVER_NAME, '-e', 'POSTPILE_PROFILE=default', '--', 'pnpm', '-C', launcher.repoRoot, 'cli', 'mcp'];
  }
  return ['mcp', 'add', MCP_SERVER_NAME, '--', 'postpile-mcp'];
}

/** A word as a shell reads it: quoted only when it holds a space or a character the shell would act on. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** The add command as the user would type it. */
export function mcpAddCommand(launcher: McpLauncher | null): string {
  return ['claude', ...mcpAddArgs(launcher)].map(shellWord).join(' ');
}

/** The command any MCP client runs over stdio. */
export function mcpServerCommand(launcher: McpLauncher | null): string {
  if (launcher?.kind === 'app') {
    return shellWord(launcher.path);
  }
  if (launcher?.kind === 'dev') {
    return `POSTPILE_PROFILE=default pnpm -C ${shellWord(launcher.repoRoot)} cli mcp`;
  }
  return 'postpile-mcp';
}
