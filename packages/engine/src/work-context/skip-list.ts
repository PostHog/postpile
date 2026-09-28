import { existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Private projects never leave the machine: the work context collector
// skips ~/.claude/projects folders (memory and sessions) whose project
// matches the skip list. Folders are the project path with every
// non-alphanumeric character turned into "-", e.g.
// -Users-me-workspace-taxes for /Users/me/workspace/taxes.

/** Default skip list: personal projects. POSTPILE_SWEEP_SKIP replaces it. */
export const DEFAULT_SWEEP_SKIP = ['taxes', 'garden', 'hobby', 'my-blog-com'];

/** POSTPILE_SWEEP_SKIP (comma separated) when set, even to '' (skip nothing); the defaults otherwise. */
export function sweepSkipFromEnv(value: string | undefined): string[] {
  if (value === undefined) {
    return DEFAULT_SWEEP_SKIP;
  }
  return value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
}

/** Lowercase, every run of non-alphanumerics as one "-", the way Claude Code names project folders. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The project's folder name (last path segment) from a ~/.claude/projects
 * folder name. The encoding is lossy ("-" can be "/" or a dash in a name),
 * so the path is walked on disk: at each level the longest run of tokens
 * that exists as a folder wins. Once nothing exists (a deleted project, or a
 * name with dots), the rest of the tokens is the last segment.
 */
export function projectFolderName(folder: string, isDir: (path: string) => boolean = isDirectory): string {
  const tokens = folder.replace(/^-+/, '').split('-');
  let path: string = sep;
  let start = 0;
  while (start < tokens.length) {
    let next = -1;
    for (let end = tokens.length; end > start; end -= 1) {
      if (isDir(join(path, tokens.slice(start, end).join('-')))) {
        next = end;
        break;
      }
    }
    if (next < 0 || next === tokens.length) {
      return tokens.slice(start).join('-');
    }
    path = join(path, tokens.slice(start, next).join('-'));
    start = next;
  }
  return tokens.at(-1) ?? folder;
}

/**
 * Whether a ~/.claude/projects folder is on the skip list: its project's
 * last path segment equals or starts with a pattern. Case and punctuation
 * do not count ("my-blog-com" matches my-blog.com).
 */
export class SweepSkipList {
  private readonly patterns: string[];

  constructor(
    readonly rawPatterns: string[],
    private readonly isDir: (path: string) => boolean = isDirectory,
  ) {
    this.patterns = rawPatterns.map(normalize).filter((pattern) => pattern !== '' && pattern !== '-');
  }

  skips(folder: string): boolean {
    if (this.patterns.length === 0) {
      return false;
    }
    const last = normalize(projectFolderName(folder, this.isDir));
    const encoded = normalize(folder);
    return this.patterns.some((pattern) => last === pattern || last.startsWith(pattern) || encoded.endsWith(`-${pattern}`));
  }
}
