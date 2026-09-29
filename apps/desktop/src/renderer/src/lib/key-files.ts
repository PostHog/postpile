import type { KeyFile, Pr } from '@postpile/core';

export interface KeyFileRow {
  path: string;
  /** Middle-truncated for the row; the full path goes in the tooltip. */
  shortPath: string;
  why: string;
  /** From the PR's file list; null when the file is not in the stored list (older snapshot). */
  additions: number | null;
  deletions: number | null;
}

/**
 * "a/very/long/dir/file.ts" -> "a/very/l…/file.ts": the file name stays
 * whole, the directory gives way from the middle. A name longer than the
 * room keeps its end.
 */
export function middleTruncate(path: string, max: number): string {
  if (path.length <= max) {
    return path;
  }
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  if (slash < 0 || name.length + 2 >= max) {
    return `…${name.slice(-(max - 1))}`;
  }
  return `${path.slice(0, max - name.length - 2)}…/${name}`;
}

/** The glance's "look at first" files with their +/- counts from the PR. */
export function keyFileRows(keyFiles: KeyFile[], pr: Pr, max = 46): KeyFileRow[] {
  const counts = new Map(pr.files.map((file) => [file.path, file]));
  return keyFiles.map((file) => {
    const count = counts.get(file.path);
    return {
      path: file.path,
      shortPath: middleTruncate(file.path, max),
      why: file.why,
      additions: count?.additions ?? null,
      deletions: count?.deletions ?? null,
    };
  });
}

/** The PR's "Files changed" tab on GitHub. */
export function filesTabUrl(prUrl: string): string {
  return `${prUrl.replace(/\/+$/, '')}/files`;
}
