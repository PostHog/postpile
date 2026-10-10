import {
  claudeBlocksAgent,
  claudeStatus,
  ghBlocksSync,
  ghStatus,
  TOOL_FIXES,
  type ClaudeState,
  type GhState,
  type SetupCheck,
  type SetupChecksView,
  type ToolsView,
} from '@postpile/core';

/**
 * What POSTPILE_FAKE_MISSING can simulate, so every missing-tool state can be
 * looked at in the static renderer build: gh not installed, not logged in,
 * token refused, offline; claude not installed, not logged in, at its limit.
 */
export const FAKE_TOOL_PROBLEMS = ['gh', 'gh-auth', 'gh-token', 'gh-offline', 'claude', 'claude-auth', 'claude-limit'] as const;
export type FakeToolProblem = (typeof FAKE_TOOL_PROBLEMS)[number];

const GH_STATES: Partial<Record<FakeToolProblem, GhState>> = { gh: 'missing', 'gh-auth': 'logged_out', 'gh-token': 'rejected', 'gh-offline': 'offline' };
const CLAUDE_STATES: Partial<Record<FakeToolProblem, ClaudeState>> = { claude: 'missing', 'claude-auth': 'logged_out', 'claude-limit': 'limited' };

/** "gh,claude-limit" -> the known problems, in order, unknown words dropped. Empty or unset: none. */
export function fakeToolProblems(value: string | undefined): FakeToolProblem[] {
  const known = new Set<string>(FAKE_TOOL_PROBLEMS);
  const words = (value ?? '').split(',').map((word) => word.trim().toLowerCase());
  return [...new Set(words.filter((word): word is FakeToolProblem => known.has(word)))];
}

/** Sample paths; no real machine's layout. */
const GH_PATH = '/opt/homebrew/bin/gh';
const CLAUDE_PATH = '/usr/local/bin/claude';
/** A usage limit in sample data resets this long after start. */
const LIMIT_MS = 45 * 60_000;

/**
 * The tool status of sample data: all fine, unless POSTPILE_FAKE_MISSING
 * names problems. "Check again" finds the same problems again: the fake
 * cannot install anything.
 */
export class FakeTools {
  private readonly gh: GhState;
  private readonly claude: ClaudeState;
  private readonly limitUntil: string;
  private checkedAt: string;

  constructor(
    problems: FakeToolProblem[],
    private readonly now: () => Date,
  ) {
    this.gh = problems.map((problem) => GH_STATES[problem]).find((state) => state !== undefined) ?? 'ok';
    this.claude = problems.map((problem) => CLAUDE_STATES[problem]).find((state) => state !== undefined) ?? 'ok';
    this.limitUntil = new Date(now().getTime() + LIMIT_MS).toISOString();
    this.checkedAt = now().toISOString();
  }

  view(): ToolsView {
    const ghMissing = this.gh === 'missing';
    const claudeMissing = this.claude === 'missing';
    const broken = ghBlocksSync(this.gh) || claudeMissing || this.claude === 'logged_out';
    return {
      gh: ghStatus(this.gh, ghMissing ? null : GH_PATH, ghMissing ? '' : 'gh version 2.60.0 (sample data)'),
      claude: claudeStatus(this.claude, claudeMissing ? null : CLAUDE_PATH, claudeMissing ? '' : '2.1.0 (Claude Code) (sample data)', this.claude === 'limited' ? this.limitUntil : null),
      canSync: !ghBlocksSync(this.gh),
      agentOn: !claudeBlocksAgent(this.claude),
      checkedAt: this.checkedAt,
      nextCheckAt: broken ? new Date(Date.parse(this.checkedAt) + 60_000).toISOString() : null,
    };
  }

  check(): ToolsView {
    this.checkedAt = this.now().toISOString();
    return this.view();
  }

  /** The gh headline while a sync would fail; null otherwise. */
  ghOff(): string | null {
    return ghBlocksSync(this.gh) ? ghStatus(this.gh, null).headline : null;
  }

  /**
   * gh missing or logged out reads as a first run: nothing was ever synced,
   * so the sample shows no topics. A refused token reads as a login that
   * expired later: the topics stay and the note sits above them.
   */
  neverSynced(): boolean {
    return this.gh === 'missing' || this.gh === 'logged_out';
  }

  /** gh works but GitHub cannot be reached: syncs and polls run and fail. */
  offline(): boolean {
    return this.gh === 'offline';
  }

  /** The claude headline while the agent is off; null otherwise. */
  agentOff(): string | null {
    return claudeBlocksAgent(this.claude) ? claudeStatus(this.claude, null).headline : null;
  }

  /** The canned setup checks with the simulated problems, like the real checks would find them. */
  setupChecks(base: SetupChecksView): SetupChecksView {
    const skipped = (check: SetupCheck): SetupCheck => ({ ...check, state: 'skipped', detail: 'Waits for the check above.', fix: null });
    const checks = base.checks.map((check): SetupCheck => {
      if (check.id === 'gh' && this.gh === 'missing') {
        return { ...check, state: 'fail', detail: 'gh is not on your PATH.', fix: TOOL_FIXES.installGh };
      }
      if (check.id === 'gh_auth' && this.gh === 'missing') {
        return skipped(check);
      }
      if (check.id === 'gh_auth' && (this.gh === 'logged_out' || this.gh === 'rejected')) {
        return { ...check, state: 'fail', detail: this.gh === 'logged_out' ? 'gh has no login yet.' : 'GitHub did not accept the login: Bad credentials', fix: TOOL_FIXES.ghLogin };
      }
      if (check.id === 'notifications' && ghBlocksSync(this.gh)) {
        return skipped(check);
      }
      if (check.id === 'claude' && this.claude === 'missing') {
        return { ...check, state: 'warn', detail: 'claude is not on your PATH. Agent features (topics, dossiers, glances, this draft) will not work without it.', fix: TOOL_FIXES.installClaude };
      }
      if (check.id === 'claude' && this.claude === 'logged_out') {
        return { ...check, state: 'warn', detail: '2.1.0 (Claude Code), but not logged in. Agent features will not work until it is.', fix: TOOL_FIXES.claudeLogin };
      }
      return check;
    });
    const ok = (id: SetupCheck['id']) => checks.find((check) => check.id === id)?.state === 'ok';
    return {
      checks,
      login: ok('gh_auth') ? base.login : null,
      canContinue: ok('gh') && ok('gh_auth') && ok('notifications'),
      agentAvailable: ok('claude'),
    };
  }
}
