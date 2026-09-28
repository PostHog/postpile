import type { IsoTime } from './types.ts';

// "What you're working on": a short digest the agent writes once a day from
// the user's local Claude Code data (CLAUDE.md, memory files, recent session
// prompts). Agent-written and kept apart from the user's own instructions.md.

export type WorkContextSourceKind = 'memory' | 'claude_md' | 'session';

/** Where a thread came from. ref is readable as is: a file path, or "project · date · title" for a session. */
export interface WorkContextSource {
  kind: WorkContextSourceKind;
  ref: string;
}

export interface WorkContextThread {
  title: string;
  detail: string;
  /** Topics the thread is about. Only ids the sweep was shown survive. */
  topicIds: string[];
  sources: WorkContextSource[];
}

/** The agent's answer, as stored. */
export interface WorkContextDigest {
  /** 3-6 sentences. */
  summary: string;
  threads: WorkContextThread[];
  /** Newest moment the input covered (last session activity), null when it had no sessions. */
  lastSeenAt: IsoTime | null;
}

/** Something the collector left out, for the log and the stats. */
export interface WorkContextDrop {
  kind: WorkContextSourceKind;
  ref: string;
  reason: string;
}

export interface WorkContextInputStats {
  budgetChars: number;
  /** Characters of collected material that went into the prompt. */
  sentChars: number;
  claudeMdFiles: number;
  memoryFiles: number;
  sessions: number;
  /** Session files modified in the window, before any filtering. */
  sessionFilesScanned: number;
  maskedSecrets: number;
  droppedCount: number;
  /** The first few drops; droppedCount has the full number. */
  dropped: WorkContextDrop[];
  /** ~/.claude/projects folders the skip list kept out (never read). Missing on versions from before the skip list. */
  skippedProjects?: number;
  /** The skip list used for this sweep. */
  skipPatterns?: string[];
}

/** One stored sweep result. */
export interface WorkContextVersion {
  version: number;
  digest: WorkContextDigest;
  /** Every source that went into the prompt, so "Why?" can say what the agent saw. */
  inputSources: WorkContextSource[];
  inputStats: WorkContextInputStats;
  model: string;
  createdAt: IsoTime;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Local hour from which the daily sweep may run. */
export const SWEEP_MORNING_HOUR = 6;
/** A successful sweep counts for this long. */
export const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
/** After a failed sweep, wait this long before the schedule tries again (Refresh always works). */
export const SWEEP_RETRY_MS = 2 * 60 * 60 * 1000;
/** How often the desktop app checks whether a sweep is due. */
export const SWEEP_CHECK_MS = 30 * 60 * 1000;

export interface SweepHistory {
  lastSuccessAt: IsoTime | null;
  lastFailureAt: IsoTime | null;
}

/**
 * Due when it is morning or later (local time), no sweep succeeded in the
 * last 24 hours, and no sweep failed in the last two.
 */
export function sweepDue(now: Date, history: SweepHistory): boolean {
  if (now.getHours() < SWEEP_MORNING_HOUR) {
    return false;
  }
  const nowMs = now.getTime();
  if (history.lastSuccessAt !== null && nowMs - Date.parse(history.lastSuccessAt) < SWEEP_EVERY_MS) {
    return false;
  }
  if (history.lastFailureAt !== null && nowMs - Date.parse(history.lastFailureAt) < SWEEP_RETRY_MS) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Prompt text
// ---------------------------------------------------------------------------

/** The digest in other prompts stays small; it is background, not the task. */
export const WORK_CONTEXT_PROMPT_MAX = 5000;
/** Thread details are cut to this in other prompts; the UI shows them whole. */
const THREAD_DETAIL_IN_PROMPT = 240;

function clipDetail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= THREAD_DETAIL_IN_PROMPT ? trimmed : `${trimmed.slice(0, THREAD_DETAIL_IN_PROMPT - 1).trimEnd()}…`;
}

function threadLine(thread: WorkContextThread, topicNames: Map<string, string>): string {
  const topics = thread.topicIds.map((id) => topicNames.get(id)).filter((name): name is string => name !== undefined);
  const about = topics.length > 0 ? ` (topics: ${topics.join(', ')})` : '';
  return `- ${thread.title}: ${clipDetail(thread.detail)}${about}`;
}

/**
 * Compact text of a digest for other prompts: date, summary, one line per
 * thread with its topic names, whole threads only up to
 * WORK_CONTEXT_PROMPT_MAX. Forgotten threads (titles lowercased) are left out
 * right away, before the next sweep drops them for good.
 */
export function workContextPromptText(
  version: Pick<WorkContextVersion, 'digest' | 'createdAt'>,
  topicNames: Map<string, string>,
  forgottenTitles: Set<string>,
): string {
  const threads = version.digest.threads.filter((thread) => !forgottenTitles.has(thread.title.trim().toLowerCase()));
  let text = `As of ${version.createdAt.slice(0, 10)}: ${version.digest.summary.trim()}`;
  if (threads.length > 0) {
    text += '\nThreads:';
  }
  for (const thread of threads) {
    const line = `\n${threadLine(thread, topicNames)}`;
    if (text.length + line.length > WORK_CONTEXT_PROMPT_MAX) {
      break;
    }
    text += line;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface WorkContextThreadView {
  /** Position in the stored digest; Forget names it together with the version. */
  index: number;
  title: string;
  detail: string;
  /** Linked topics that still exist. */
  topics: { id: string; name: string }[];
  sources: WorkContextSource[];
  /** The user said Forget; the next sweep drops it. */
  forgotten: boolean;
}

export interface WorkContextView {
  current: {
    version: number;
    createdAt: IsoTime;
    model: string;
    summary: string;
    lastSeenAt: IsoTime | null;
    threads: WorkContextThreadView[];
    inputStats: WorkContextInputStats;
  } | null;
  /** The last sweep failed after the newest success. The previous version stays in use. */
  lastError: { message: string; at: IsoTime } | null;
  running: boolean;
  /**
   * Project folders under ~/.claude/projects the sweep never reads, matched
   * against the project's folder name: POSTPILE_SWEEP_SKIP, else sweepSkip
   * in the user's config.json, else the defaults.
   */
  skipPatterns: string[];
  /** Where skipPatterns come from. With 'env' an edit to the config file has no effect until the variable is gone. */
  skipSource?: SweepSkipSource;
  /** The config file the skip list is saved to; null when this engine has none (sample data, tests). */
  skipConfigFile?: string | null;
}

/** Where the sweep's skip list comes from: POSTPILE_SWEEP_SKIP, the user's config.json, or the defaults. */
export type SweepSkipSource = 'env' | 'config' | 'default';

export interface WorkContextSweepResult {
  ok: boolean;
  message: string;
  /** The stored version, null when the sweep failed. */
  version: number | null;
  stats: WorkContextInputStats | null;
}

export interface WorkThreadForget {
  version: number;
  index: number;
}
