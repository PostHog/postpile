import type { SweepSkipSource } from '@postpile/core';

// Private projects never leave the machine: the work context collector
// skips ~/.claude/projects folders (memory and sessions) whose project
// matches the skip list. Folders are the project path with every
// non-alphanumeric character turned into "-", e.g.
// -Users-me-workspace-taxes for /Users/me/workspace/taxes.
//
// The encoding is lossy ("-" can be "/", ".", "_" or a dash in a name), and
// decoding it on disk would stat paths all over the machine (~/Pictures,
// cloud drives, /Volumes), which makes macOS ask for privacy permissions.
// So matching works on the folder name's tokens only and errs on the side of
// skipping: a pattern matches wherever its tokens show up as a run, since
// the tokens after it may still belong to the same project folder name.

/**
 * Default skip list: generic words only, since the defaults ship with the
 * app. Real project names belong in sweepSkip in config.json, or
 * POSTPILE_SWEEP_SKIP; either replaces this list.
 */
export const DEFAULT_SWEEP_SKIP = ['personal', 'private'];

/** Comma separated patterns, trimmed, empties dropped. */
export function parseSkipList(text: string): string[] {
  return text
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
}

/** POSTPILE_SWEEP_SKIP (comma separated) when set, even to '' (skip nothing); the defaults otherwise. */
export function sweepSkipFromEnv(value: string | undefined): string[] {
  return value === undefined ? DEFAULT_SWEEP_SKIP : parseSkipList(value);
}

/**
 * The skip list in use: POSTPILE_SWEEP_SKIP when set (even to ''), else
 * sweepSkip from the user's config file, else the defaults.
 */
export function resolveSweepSkip(envValue: string | undefined, configValue: string[] | undefined): { patterns: string[]; source: SweepSkipSource } {
  if (envValue !== undefined) {
    return { patterns: parseSkipList(envValue), source: 'env' };
  }
  if (configValue !== undefined) {
    return { patterns: configValue, source: 'config' };
  }
  return { patterns: DEFAULT_SWEEP_SKIP, source: 'default' };
}

/** Lowercase tokens split on every run of non-alphanumerics, the way Claude Code names project folders. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/** Whether `run` appears as consecutive whole tokens anywhere in `all`. */
function containsRun(all: string[], run: string[]): boolean {
  for (let start = 0; start + run.length <= all.length; start += 1) {
    if (run.every((token, offset) => all[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a ~/.claude/projects folder is on the skip list: the pattern's
 * tokens appear as a consecutive run of whole tokens in the folder name.
 * Case and punctuation do not count ("my-blog-com" matches my-blog.com),
 * but tokens must match whole ("tax" does not match "taxes"). A match in a
 * parent folder or in the middle of a name also skips: over-skipping only
 * loses context, under-skipping leaks a private project.
 */
export class SweepSkipList {
  private readonly patterns: string[][];

  constructor(readonly rawPatterns: string[]) {
    this.patterns = rawPatterns.map(tokens).filter((pattern) => pattern.length > 0);
  }

  skips(folder: string): boolean {
    const folderTokens = tokens(folder);
    return this.patterns.some((pattern) => containsRun(folderTokens, pattern));
  }
}
