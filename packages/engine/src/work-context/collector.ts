import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ContextSweepItem } from '@postpile/agent';
import type { IsoTime, WorkContextDrop, WorkContextInputStats, WorkContextSourceKind } from '@postpile/core';
import { maskSecrets } from './secrets.ts';
import { readSessionSignals, type SessionSignals } from './session-reader.ts';
import { SweepSkipList } from './skip-list.ts';

// Collects the sweep's input from the local Claude Code folder, deterministic
// and without the agent: the global CLAUDE.md and the files it @-includes,
// every project's memory files, and light signals from sessions of the last
// days. Project folders on the skip list are never read. Everything is
// masked for secrets and cut to a character budget; what does not fit is
// dropped and counted.

/** Character budget per section. Unused room carries over to the next section. */
export interface CollectBudget {
  claudeMd: number;
  sessions: number;
  memory: number;
}

/** About 60k characters in total, roughly 15k tokens. */
export const DEFAULT_COLLECT_BUDGET: CollectBudget = { claudeMd: 6_000, sessions: 30_000, memory: 24_000 };

/** Sessions whose file changed within this many days count as recent. */
export const SESSION_DAYS = 7;

/** Per-item caps, so one long file cannot eat a whole section. */
const CLAUDE_MD_MAX = 5_000;
const MEMORY_INDEX_MAX = 2_500;
const MEMORY_FILE_MAX = 1_200;
/** @-includes followed from CLAUDE.md, counting nested ones. */
const INCLUDE_DEPTH = 3;
/** Drops kept by name in the stats; the count has all of them. */
const DROPS_LISTED = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
/** "@path" at the start of a line or after a space. Emails ("a@b.c") never match. */
const INCLUDE = /(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+)/g;

export interface CollectorOptions {
  /** POSTPILE_CLAUDE_DIR, default ~/.claude. */
  claudeDir: string;
  now: Date;
  /** Shown as "~" in refs. */
  home?: string;
  budget?: CollectBudget;
  sessionDays?: number;
  /** ~/.claude/projects folders never read (memory and sessions). Defaults to skipping nothing. */
  skipList?: SweepSkipList;
  log?: (message: string) => void;
}

export interface CollectedContext {
  items: ContextSweepItem[];
  stats: WorkContextInputStats;
  /** Newest session activity that made it into the items. */
  lastSeenAt: IsoTime | null;
}

/** A candidate before the budget decides. */
interface Candidate {
  kind: WorkContextSourceKind;
  ref: string;
  text: string;
}

/** The claude dir from the environment: POSTPILE_CLAUDE_DIR, else ~/.claude. */
export function claudeDirFromEnv(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.POSTPILE_CLAUDE_DIR || join(home, '.claude');
}

function clipBlock(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}\n[... cut]`;
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * The file's text, or null when it cannot be read: a directory, a broken
 * symlink, no permission, gone meanwhile. One bad file never stops the sweep.
 */
function readTextFile(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Lines inside ``` fences are examples, not includes. */
function includeTargets(text: string): string[] {
  const targets: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    for (const match of line.matchAll(INCLUDE)) {
      if (match[1]) {
        targets.push(match[1]);
      }
    }
  }
  return targets;
}

function localStamp(iso: string | null): string {
  if (!iso) {
    return '?';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export class WorkContextCollector {
  private readonly home: string;
  private readonly budget: CollectBudget;
  private readonly sessionDays: number;
  private readonly log: (message: string) => void;
  private readonly drops: WorkContextDrop[] = [];
  private readonly skipList: SweepSkipList;
  /** Project folders the skip list kept out; names stay out of the stats on purpose. */
  private readonly skippedProjects = new Set<string>();
  private maskedSecrets = 0;

  constructor(private readonly options: CollectorOptions) {
    this.home = options.home ?? homedir();
    this.budget = options.budget ?? DEFAULT_COLLECT_BUDGET;
    this.sessionDays = options.sessionDays ?? SESSION_DAYS;
    this.log = options.log ?? (() => {});
    this.skipList = options.skipList ?? new SweepSkipList([]);
  }

  /** The project folders to read, without the skipped ones. */
  private projectFolders(projectsDir: string): string[] {
    return listDir(projectsDir).filter((folder) => {
      if (this.skipList.skips(folder)) {
        this.skippedProjects.add(folder);
        return false;
      }
      return true;
    });
  }

  /** "~/.claude/..." instead of the full home path. */
  private display(path: string): string {
    return isInside(path, this.home) ? `~${sep}${relative(this.home, path)}` : path;
  }

  private drop(kind: WorkContextSourceKind, ref: string, reason: string): void {
    this.drops.push({ kind, ref, reason });
  }

  private masked(text: string): string {
    const result = maskSecrets(text);
    this.maskedSecrets += result.count;
    return result.text;
  }

  // -- CLAUDE.md -------------------------------------------------------------

  /**
   * Includes resolve against the including file's folder, then against the
   * folder of its symlink target (~/.claude/CLAUDE.md usually points into a
   * dotfiles repo). Only files under ~/.claude or that dotfiles folder count.
   * The path is checked against those folders before the disk is touched:
   * an include like @~/Pictures/x or @/Volumes/x must never be looked up,
   * since macOS asks for a privacy permission on the first stat there.
   */
  private resolveInclude(target: string, from: string, roots: string[]): string | null {
    const base = target.startsWith('~/') ? join(this.home, target.slice(2)) : target;
    const folders = [dirname(from), dirname(safeRealpath(from) ?? from)];
    for (const folder of folders) {
      const candidate = isAbsolute(base) ? base : resolve(folder, base);
      if (!roots.some((root) => isInside(candidate, root))) {
        continue;
      }
      const real = existsSync(candidate) ? safeRealpath(candidate) : null;
      if (real && statSync(real).isFile() && roots.some((root) => isInside(real, root))) {
        return candidate;
      }
    }
    return null;
  }

  private claudeMdCandidates(): Candidate[] {
    const main = join(this.options.claudeDir, 'CLAUDE.md');
    const mainReal = safeRealpath(main);
    if (!mainReal) {
      return [];
    }
    const roots = [this.options.claudeDir, safeRealpath(this.options.claudeDir) ?? this.options.claudeDir, dirname(mainReal)];
    const seen = new Set<string>();
    const found: Candidate[] = [];
    const visit = (path: string, depth: number): void => {
      const real = safeRealpath(path) ?? path;
      if (seen.has(real)) {
        return;
      }
      seen.add(real);
      const text = readTextFile(path);
      if (text === null) {
        return;
      }
      found.push({ kind: 'claude_md', ref: this.display(path), text: clipBlock(text, CLAUDE_MD_MAX) });
      if (depth >= INCLUDE_DEPTH) {
        return;
      }
      for (const target of includeTargets(text)) {
        const included = this.resolveInclude(target, path, roots);
        if (included) {
          visit(included, depth + 1);
        }
      }
    };
    visit(main, 0);
    return found;
  }

  // -- memory ----------------------------------------------------------------

  /**
   * MEMORY.md indexes first (they say what each project is about), then
   * memory files changed within the session window, then the rest; newest
   * first inside each group.
   */
  private memoryCandidates(): Candidate[] {
    const projectsDir = join(this.options.claudeDir, 'projects');
    const recentSince = this.options.now.getTime() - this.sessionDays * DAY_MS;
    const files: { path: string; group: number; mtime: number; index: boolean }[] = [];
    for (const project of this.projectFolders(projectsDir)) {
      const memoryDir = join(projectsDir, project, 'memory');
      for (const name of listDir(memoryDir)) {
        if (!name.endsWith('.md')) {
          continue;
        }
        const path = join(memoryDir, name);
        const mtime = mtimeMs(path);
        const index = name === 'MEMORY.md';
        files.push({ path, mtime, index, group: index ? 0 : mtime >= recentSince ? 1 : 2 });
      }
    }
    files.sort((a, b) => a.group - b.group || b.mtime - a.mtime);
    return files.flatMap((file) => {
      const text = readTextFile(file.path);
      if (text === null) {
        return [];
      }
      return [{ kind: 'memory' as const, ref: this.display(file.path), text: clipBlock(text, file.index ? MEMORY_INDEX_MAX : MEMORY_FILE_MAX) }];
    });
  }

  // -- sessions --------------------------------------------------------------

  private sessionFiles(): { path: string; sessionId: string; projectDir: string }[] {
    const projectsDir = join(this.options.claudeDir, 'projects');
    const since = this.options.now.getTime() - this.sessionDays * DAY_MS;
    const files: { path: string; sessionId: string; projectDir: string }[] = [];
    for (const projectDir of this.projectFolders(projectsDir)) {
      for (const name of listDir(join(projectsDir, projectDir))) {
        const path = join(projectsDir, projectDir, name);
        if (name.endsWith('.jsonl') && mtimeMs(path) >= since) {
          files.push({ path, sessionId: name.slice(0, -'.jsonl'.length), projectDir });
        }
      }
    }
    return files;
  }

  private sessionRef(session: SessionSignals, projectDir: string): string {
    const project = session.cwd ? basename(session.cwd) : projectDir;
    const title = session.title ? ` · "${session.title}"` : '';
    return `${project} · ${localStamp(session.startedAt)}${title}`;
  }

  private sessionText(session: SessionSignals): string {
    const lines = [`cwd ${session.cwd ? this.display(session.cwd) : '?'}, ${localStamp(session.startedAt)} to ${localStamp(session.endedAt)}`];
    if (session.prompts.length > 0) {
      lines.push('First prompts:', ...session.prompts.map((prompt) => `- ${prompt}`));
    }
    if (session.compaction) {
      lines.push(`Compaction summary: ${session.compaction}`);
    }
    return lines.join('\n');
  }

  /** Newest session first. SDK sessions, forks and sessions without anything typed or titled are dropped. */
  private async sessionCandidates(): Promise<{ candidates: (Candidate & { endedAt: string | null })[]; scanned: number }> {
    const files = this.sessionFiles();
    const sessions: { signals: SessionSignals; projectDir: string }[] = [];
    for (const file of files) {
      try {
        sessions.push({ signals: await readSessionSignals(file.path, file.sessionId), projectDir: file.projectDir });
      } catch (error) {
        this.drop('session', file.path, `unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    sessions.sort((a, b) => (b.signals.endedAt ?? '').localeCompare(a.signals.endedAt ?? ''));
    const candidates: (Candidate & { endedAt: string | null })[] = [];
    // A forked session starts with its parent's prompts; the newest copy wins.
    const seenPrompts = new Set<string>();
    for (const { signals, projectDir } of sessions) {
      const ref = this.sessionRef(signals, projectDir);
      const promptKey = signals.prompts.join('\n');
      if (signals.sdk) {
        this.drop('session', ref, 'started by a program (SDK)');
      } else if (signals.prompts.length === 0 && signals.compaction === null && signals.title === null) {
        this.drop('session', ref, 'no typed prompts');
      } else if (promptKey !== '' && seenPrompts.has(promptKey)) {
        this.drop('session', ref, 'same prompts as a newer session (fork)');
      } else {
        seenPrompts.add(promptKey);
        candidates.push({ kind: 'session', ref, text: this.sessionText(signals), endedAt: signals.endedAt });
      }
    }
    return { candidates, scanned: files.length };
  }

  // -- budget ----------------------------------------------------------------

  /** Takes candidates in order while they fit; returns what is left of the room. */
  private take<T extends Candidate>(candidates: T[], room: number, taken: T[]): number {
    let left = room;
    for (const candidate of candidates) {
      const text = this.masked(candidate.text);
      if (text.length > left) {
        this.drop(candidate.kind, candidate.ref, 'over budget');
        continue;
      }
      left -= text.length;
      taken.push({ ...candidate, text });
    }
    return left;
  }

  async collect(): Promise<CollectedContext> {
    const claudeMd: Candidate[] = [];
    const sessions: (Candidate & { endedAt: string | null })[] = [];
    const memory: Candidate[] = [];
    let room = this.take(this.claudeMdCandidates(), this.budget.claudeMd, claudeMd);
    const found = await this.sessionCandidates();
    room = this.take(found.candidates, room + this.budget.sessions, sessions);
    this.take(this.memoryCandidates(), room + this.budget.memory, memory);

    const prefixes: Record<WorkContextSourceKind, string> = { claude_md: 'c', session: 's', memory: 'm' };
    const counters: Record<WorkContextSourceKind, number> = { claude_md: 0, session: 0, memory: 0 };
    const items: ContextSweepItem[] = [...claudeMd, ...sessions, ...memory].map((candidate) => {
      counters[candidate.kind] += 1;
      return { id: `${prefixes[candidate.kind]}${counters[candidate.kind]}`, kind: candidate.kind, ref: candidate.ref, text: candidate.text };
    });
    const budgetChars = this.budget.claudeMd + this.budget.sessions + this.budget.memory;
    const stats: WorkContextInputStats = {
      budgetChars,
      sentChars: items.reduce((sum, item) => sum + item.text.length, 0),
      claudeMdFiles: claudeMd.length,
      memoryFiles: memory.length,
      sessions: sessions.length,
      sessionFilesScanned: found.scanned,
      maskedSecrets: this.maskedSecrets,
      droppedCount: this.drops.length,
      dropped: this.drops.slice(0, DROPS_LISTED),
      skippedProjects: this.skippedProjects.size,
      skipPatterns: this.skipList.rawPatterns,
    };
    this.logDrops();
    if (this.skippedProjects.size > 0) {
      this.log(`work context: skipped ${this.skippedProjects.size} project folders (skip list)`);
    }
    const lastSeenAt = sessions.map((session) => session.endedAt).filter((at): at is string => at !== null).sort().at(-1) ?? null;
    return { items, stats, lastSeenAt };
  }

  private logDrops(): void {
    const byReason = new Map<string, number>();
    for (const drop of this.drops) {
      const key = `${drop.kind}: ${drop.reason}`;
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byReason) {
      this.log(`work context: dropped ${count} (${key})`);
    }
  }
}
