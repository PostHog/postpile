import { claudeCanManageMcp, mcpAddCommand, mcpServerCommand, type ActionResult, type ClaudeState, type McpConnectionView, type McpLauncher } from '@postpile/core';

/** A sample install path; no real machine's layout. */
const SAMPLE_LAUNCHER: McpLauncher = { kind: 'app', path: '/Applications/PostPile.app/Contents/Resources/postpile-mcp' };

/**
 * "Add to Claude Code" in sample data: starts not connected, and a click
 * "adds" it in memory. Never runs claude and never touches the real Claude
 * Code config. With POSTPILE_FAKE_MISSING=claude or claude-auth it stays
 * unknown, like the engine, so the footer does not ask.
 */
export class FakeMcp {
  private connected = false;
  private hidden = false;
  private checkedAt: string;

  constructor(
    private readonly claudeState: () => ClaudeState,
    private readonly now: () => Date,
    private readonly delayMs: number,
  ) {
    this.checkedAt = now().toISOString();
  }

  private blockedReason(): string | null {
    return claudeCanManageMcp(this.claudeState()) ? null : 'Needs claude: sample data simulates it missing or logged out.';
  }

  view(): McpConnectionView {
    const blockedReason = this.blockedReason();
    return {
      state: blockedReason !== null ? 'unknown' : this.connected ? 'connected' : 'not_connected',
      blockedReason,
      addCommand: mcpAddCommand(SAMPLE_LAUNCHER),
      serverCommand: mcpServerCommand(SAMPLE_LAUNCHER),
      hidden: this.hidden,
      checkedAt: this.checkedAt,
      error: null,
    };
  }

  /** Waits a moment like the real `claude mcp add`, then counts as added. */
  async connect(): Promise<ActionResult> {
    const blockedReason = this.blockedReason();
    if (blockedReason !== null) {
      return { ok: false, message: blockedReason, undoToken: null };
    }
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.connected = true;
    this.checkedAt = this.now().toISOString();
    return { ok: true, message: 'fake: added to Claude Code in memory, the real Claude Code config is unchanged', undoToken: null };
  }

  hide(): ActionResult {
    this.hidden = true;
    return { ok: true, message: 'Hidden. Setup still offers it when you run it again.', undoToken: null };
  }
}
