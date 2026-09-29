import { execFile } from 'node:child_process';
import { claudeHasAuthStatus, claudeLoggedIn, TOOL_FIXES, TOOL_PATH_HINT, type SetupCheck, type SetupChecksView } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import { errorText } from '../errors.ts';

export interface CommandResult {
  ok: boolean;
  /** The program is not on PATH at all. */
  missing: boolean;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Tests pass a fake; the checks never need more than this. */
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

const COMMAND_TIMEOUT_MS = 10_000;

/**
 * execFile with a timeout, run in `cwd`. A missing program answers missing
 * instead of throwing. `cwd` is the app's own empty folder (agentCwdFor): a
 * child that inherits the repo or / as its folder may look around there, and
 * macOS asks for permissions in PostPile's name.
 */
export function systemCommands(cwd: string): CommandRunner {
  return (command, args) =>
    new Promise((resolve) => {
      execFile(command, args, { cwd, timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
        const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
        resolve({ ok: error === null, missing, stdout: String(stdout), stderr: String(stderr) });
      });
    });
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function skipped(id: SetupCheck['id'], label: string): SetupCheck {
  return { id, label, state: 'skipped', detail: 'Waits for the check above.', fix: null };
}

/**
 * Step 1 of the setup flow: gh installed and logged in (with the login),
 * the token can read notifications, and the claude CLI is there. Read only:
 * nothing is changed, nothing marked read.
 */
export class SetupChecks {
  constructor(
    private readonly reader: GitHubReader,
    private readonly commands: CommandRunner,
    private readonly claudeBinary: string = process.env.POSTPILE_CLAUDE_BIN || 'claude',
  ) {}

  private async ghInstalled(): Promise<SetupCheck> {
    const label = 'GitHub CLI (gh) installed';
    const result = await this.commands('gh', ['--version']);
    if (result.ok) {
      return { id: 'gh', label, state: 'ok', detail: firstLine(result.stdout), fix: null };
    }
    const detail = result.missing ? `gh is not on your PATH. ${TOOL_PATH_HINT}` : `gh --version failed: ${firstLine(result.stderr)}`;
    return { id: 'gh', label, state: 'fail', detail, fix: TOOL_FIXES.installGh };
  }

  /** The app reads its token from `gh auth token`; the viewer query proves it works and names the login. */
  private async ghLoggedIn(): Promise<{ check: SetupCheck; login: string | null }> {
    const label = 'Logged in to GitHub';
    const token = await this.commands('gh', ['auth', 'token']);
    if (!token.ok || token.stdout.trim() === '') {
      return { check: { id: 'gh_auth', label, state: 'fail', detail: 'gh has no login yet.', fix: TOOL_FIXES.ghLogin }, login: null };
    }
    try {
      const viewer = await this.reader.viewer();
      const teams = viewer.teams.length === 1 ? '1 team' : `${viewer.teams.length} teams`;
      return { check: { id: 'gh_auth', label, state: 'ok', detail: `Logged in as @${viewer.login} · ${teams}`, fix: null }, login: viewer.login };
    } catch (error) {
      return { check: { id: 'gh_auth', label, state: 'fail', detail: `GitHub did not accept the login: ${errorText(error)}`, fix: TOOL_FIXES.ghLogin }, login: null };
    }
  }

  private async notifications(): Promise<SetupCheck> {
    const label = 'GitHub notifications readable';
    try {
      const problem = await this.reader.probeNotifications();
      if (problem === null) {
        return { id: 'notifications', label, state: 'ok', detail: 'The token can read your notifications inbox.', fix: null };
      }
      return { id: 'notifications', label, state: 'fail', detail: problem, fix: TOOL_FIXES.notificationsScope };
    } catch (error) {
      return { id: 'notifications', label, state: 'fail', detail: errorText(error), fix: TOOL_FIXES.notificationsScope };
    }
  }

  private async claude(): Promise<SetupCheck> {
    const label = 'Claude Code CLI (claude) found';
    const result = await this.commands(this.claudeBinary, ['--version']);
    if (result.ok) {
      const version = firstLine(result.stdout);
      if (claudeHasAuthStatus(version)) {
        const auth = await this.commands(this.claudeBinary, ['auth', 'status', '--json']);
        if (claudeLoggedIn(auth.stdout) === false) {
          const detail = `${version}, but not logged in. Agent features will not work until it is.`;
          return { id: 'claude', label, state: 'warn', detail, fix: TOOL_FIXES.claudeLogin };
        }
      }
      return { id: 'claude', label, state: 'ok', detail: version, fix: null };
    }
    const why = result.missing ? `${this.claudeBinary} is not on your PATH.` : `${this.claudeBinary} --version failed.`;
    const hint = result.missing ? ` ${TOOL_PATH_HINT}` : '';
    const detail = `${why} Agent features (topics, dossiers, glances, this draft) will not work without it.${hint}`;
    return { id: 'claude', label, state: 'warn', detail, fix: TOOL_FIXES.installClaude };
  }

  async run(): Promise<SetupChecksView> {
    const gh = await this.ghInstalled();
    const auth = gh.state === 'ok' ? await this.ghLoggedIn() : { check: skipped('gh_auth', 'Logged in to GitHub'), login: null };
    const notifications = auth.check.state === 'ok' ? await this.notifications() : skipped('notifications', 'GitHub notifications readable');
    const claude = await this.claude();
    const checks = [gh, auth.check, notifications, claude];
    return {
      checks,
      login: auth.login,
      canContinue: gh.state === 'ok' && auth.check.state === 'ok' && notifications.state === 'ok',
      agentAvailable: claude.state === 'ok',
    };
  }
}
