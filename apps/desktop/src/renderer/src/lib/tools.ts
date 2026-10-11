import { TOOL_PATH_HINT, type ClaudeState, type GhState, type ToolStatus, type ToolsView } from '@postpile/core';
import { clockLabel, whenLabel } from './time.ts';

// What the renderer shows about gh and claude (DESIGN.md "Missing tools").
// The words and fix commands come from the server; this only picks where.

/** gh states that get the note in the middle column. Offline is left to the footer and the poll's own backoff. */
const GH_NOTE_STATES: GhState[] = ['missing', 'logged_out', 'rejected'];
/** claude states that turn the agent off, so the note says "rules only". */
const CLAUDE_NOTE_STATES: ClaudeState[] = ['missing', 'logged_out', 'limited'];

export interface ToolsNotice {
  gh: ToolStatus<GhState> | null;
  claude: ToolStatus<ClaudeState> | null;
}

/** The tools that need a note, each null when fine (or before the status loaded). */
export function toolsNotice(view: ToolsView | undefined): ToolsNotice {
  return {
    gh: view && GH_NOTE_STATES.includes(view.gh.state) ? view.gh : null,
    claude: view && CLAUDE_NOTE_STATES.includes(view.claude.state) ? view.claude : null,
  };
}

/** The one line above both notes when gh and claude are both broken: gh goes first. */
export const FIX_GH_FIRST = 'Fix gh first: nothing syncs without it. Then claude for the agent.';

/**
 * The claude note under the gh note: the "toolPath" hint is already in the
 * gh text when gh is missing too, so it shows once.
 */
export function claudeDetailUnderGh(gh: ToolStatus<GhState>, claude: ToolStatus<ClaudeState>): string {
  if (!gh.detail.includes(TOOL_PATH_HINT)) {
    return claude.detail;
  }
  return claude.detail.replace(TOOL_PATH_HINT, '').trim();
}

export interface SyncOffStatus {
  text: string;
  title: string;
}

/**
 * The title bar's words while sync is off: "gh needs a fix", or "gh and
 * claude need a fix" when claude is missing or logged out too. A usage
 * limit is not named: it ends by itself, and the footer says "agent paused".
 */
export function syncOffStatus(view: ToolsView): SyncOffStatus {
  const claudeBroken = view.claude.state === 'missing' || view.claude.state === 'logged_out';
  if (!claudeBroken) {
    return { text: 'gh needs a fix', title: `${view.gh.headline}. The note in the middle column has the fix.` };
  }
  return { text: 'gh and claude need a fix', title: `${view.gh.headline}. ${view.claude.headline}. The notes in the middle column have the fixes, gh first.` };
}

/** Often while something is wrong (each ask may run a due recheck on the server), rarely otherwise. */
export function toolsRefetchMs(view: ToolsView | undefined): number {
  const notice = toolsNotice(view);
  return notice.gh || notice.claude || view?.gh.state === 'offline' ? 30_000 : 5 * 60_000;
}

/** A usage limit: "Trying again at 15:40, in 25 min." Empty without a time. */
export function retryLine(retryAt: string | null, now: Date): string {
  if (retryAt === null) {
    return '';
  }
  const at = new Date(retryAt);
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) {
    return 'Trying again with the next agent call.';
  }
  return `Trying again at ${clockLabel(at)}, in ${minutes} min.`;
}

/**
 * Why agent-only controls (chat Send, Draft with agent, Recheck) are
 * disabled: the claude headline while the agent is off or paused, with when
 * it is tried again. Null while the agent is on or before the status loaded.
 */
export function agentOffReason(view: ToolsView | undefined, now: Date): string | null {
  if (!view || view.agentOn) {
    return null;
  }
  return [`${view.claude.headline}.`, retryLine(view.claude.retryAt, now)].filter((part) => part !== '').join(' ');
}

/** "Checked 2m ago. Checks again at 15:42." */
export function checkLine(view: ToolsView, now: Date): string {
  const parts: string[] = [];
  if (view.checkedAt) {
    parts.push(`Checked ${whenLabel(view.checkedAt, now)}.`);
  }
  if (view.nextCheckAt) {
    parts.push(`Checks again at ${clockLabel(new Date(view.nextCheckAt))}.`);
  }
  return parts.join(' ');
}

export interface ToolsFooter {
  text: string;
  title: string;
}

/** The footer's words for the tools, null when all is well. */
export function toolsFooter(view: ToolsView | undefined): ToolsFooter | null {
  if (!view) {
    return null;
  }
  const notice = toolsNotice(view);
  const parts: ToolsFooter[] = [];
  if (notice.gh) {
    parts.push({ text: 'sync off', title: notice.gh.headline });
  } else if (view.gh.state === 'offline') {
    parts.push({ text: 'GitHub unreachable', title: `${view.gh.headline}. Check your network; PostPile tries again by itself. ${view.gh.detail}`.trim() });
  }
  if (notice.claude) {
    parts.push({ text: notice.claude.state === 'limited' ? 'agent paused' : 'rules only', title: `${notice.claude.headline}. Tiles and notifications still work on rules; topics, dossiers and glances wait.` });
  }
  if (parts.length === 0) {
    return null;
  }
  return { text: parts.map((part) => part.text).join(' · '), title: parts.map((part) => part.title).join('\n') };
}
