import type { PrKey } from './types.ts';

/** Lines on the base side of a diff, both ends included. */
export interface LineRange {
  start: number;
  end: number;
}

/** What one PR changes in one file, as base-side line ranges. */
export interface FileEdits {
  /** The file's path on the base side (before a rename). */
  path: string;
  ranges: LineRange[];
}

/** One PR's edits, the input of the overlap check. No patch text, only the ranges. */
export interface PrEdits {
  prKey: PrKey;
  repo: string;
  baseRef: string;
  files: FileEdits[];
  /** The diff was cut short (too many files, or GitHub left a patch out): more may overlap than was found. */
  capped: boolean;
}

/** Where two PRs touch the same part of one file. */
export interface FileOverlap {
  path: string;
  /** Regions that cover both PRs' nearby edits, in line order, not touching each other. */
  regions: LineRange[];
}

/** Another open PR editing the same lines as the one asked about. */
export interface PrOverlap {
  other: PrKey;
  files: FileOverlap[];
  /** The other PR's diff was capped, so it may overlap in more places. */
  otherCapped: boolean;
}

/** What MCP reads: open PRs with overlaps, and the ones whose own diff was read only in part. */
export interface PrOverlapsView {
  overlaps: Record<PrKey, PrOverlap[]>;
  /** Open PRs whose diff is capped: "none found" does not mean "none". */
  capped: PrKey[];
}

/** Edits this close (in lines) count as the same place. Merge drops list entries one line off. */
export const OVERLAP_MARGIN = 3;

/** Ranges sorted, with the ones that overlap or touch joined. */
function joinRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const joined: LineRange[] = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      joined.push({ ...range });
    }
  }
  return joined;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/**
 * The base-side lines a file's patch changes, read from GitHub's patch text
 * (the text is read here and never kept). Context lines do not count, so a
 * hunk's three lines of padding never make two PRs look like neighbours.
 * A run of removed (or replaced) lines is that run of old lines; a pure
 * insertion is the gap it lands in, written as the two old lines around it.
 */
export function changedRanges(patch: string): LineRange[] {
  const ranges: LineRange[] = [];
  let oldLine = 0;
  let blockStart = 0;
  let removed = 0;
  let added = false;

  const flush = () => {
    if (removed > 0) {
      ranges.push({ start: blockStart, end: blockStart + removed - 1 });
    } else if (added) {
      ranges.push({ start: Math.max(1, blockStart - 1), end: blockStart });
    }
    removed = 0;
    added = false;
  };

  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      flush();
      const first = Number(header[1]);
      const count = header[2] === undefined ? 1 : Number(header[2]);
      // With no old lines the number names the line before the hunk.
      oldLine = count === 0 ? first + 1 : first;
      continue;
    }
    if (line.startsWith('-')) {
      if (removed === 0) {
        blockStart = oldLine;
      }
      removed += 1;
      oldLine += 1;
    } else if (line.startsWith('+')) {
      if (removed === 0 && !added) {
        blockStart = oldLine;
      }
      added = true;
    } else if (line.startsWith(' ')) {
      flush();
      oldLine += 1;
    }
    // "\ No newline at end of file" and blank lines change nothing.
  }
  flush();
  return joinRanges(ranges);
}

/** Regions where a range of one list is within `margin` lines of a range of the other. */
function nearRegions(a: LineRange[], b: LineRange[], margin: number): LineRange[] {
  const regions: LineRange[] = [];
  for (const left of a) {
    for (const right of b) {
      if (left.start <= right.end + margin && right.start <= left.end + margin) {
        regions.push({ start: Math.min(left.start, right.start), end: Math.max(left.end, right.end) });
      }
    }
  }
  return joinRanges(regions);
}

/** Overlaps in the files two PRs both edit; empty when they edit different places. */
function overlapOfPair(mine: Map<string, LineRange[]>, other: PrEdits, margin: number): FileOverlap[] {
  const files: FileOverlap[] = [];
  for (const file of other.files) {
    const ranges = mine.get(file.path);
    if (ranges === undefined) {
      continue;
    }
    const regions = nearRegions(ranges, file.ranges, margin);
    if (regions.length > 0) {
      files.push({ path: file.path, regions });
    }
  }
  return files;
}

/**
 * Which open PRs edit the same lines, per PR. Only PRs in one repo and on one
 * base branch are compared (line numbers mean the same file there), and
 * `sameStack` pairs are skipped: a stack's layers overlap by design.
 * PRs are indexed by file path first, so only PRs that share a file are
 * compared line by line.
 */
export function findOverlaps(
  prs: PrEdits[],
  sameStack: (a: PrKey, b: PrKey) => boolean,
  margin: number = OVERLAP_MARGIN,
): Map<PrKey, PrOverlap[]> {
  const byFile = new Map<string, PrEdits[]>();
  for (const pr of prs) {
    for (const file of pr.files) {
      const id = `${pr.repo}\n${pr.baseRef}\n${file.path}`;
      const list = byFile.get(id);
      if (list === undefined) {
        byFile.set(id, [pr]);
      } else {
        list.push(pr);
      }
    }
  }

  const result = new Map<PrKey, PrOverlap[]>();
  const seenPairs = new Set<string>();
  for (const sharing of byFile.values()) {
    for (const a of sharing) {
      const mine = new Map(a.files.map((file) => [file.path, file.ranges]));
      for (const b of sharing) {
        const pair = `${a.prKey}\n${b.prKey}`;
        if (a.prKey === b.prKey || seenPairs.has(pair) || sameStack(a.prKey, b.prKey)) {
          continue;
        }
        seenPairs.add(pair);
        const files = overlapOfPair(mine, b, margin);
        if (files.length > 0) {
          const list = result.get(a.prKey) ?? [];
          list.push({ other: b.prKey, files, otherCapped: b.capped });
          result.set(a.prKey, list);
        }
      }
    }
  }
  for (const list of result.values()) {
    list.sort((x, y) => x.other.localeCompare(y.other));
  }
  return result;
}
