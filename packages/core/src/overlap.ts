import type { PrKey } from './types.ts';

/**
 * Lines on the base side of a diff, both ends included. A pure insertion is
 * a zero-width range at the line it lands before: `{ start: 627, end: 626 }`
 * (end below start) is "inserted before old line 627".
 */
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

/** A file both PRs edit, with no edit on the same lines but some close by. */
export interface FileNearby {
  path: string;
  /** The other PR's close edits, from its first to its last line. */
  theirs: LineRange;
  /** The asked PR's close edits, from its first to its last line. */
  mine: LineRange;
}

/** Another open PR editing the same lines as the one asked about, or close by. */
export interface PrOverlap {
  other: PrKey;
  /** Files with edits on the same lines (the strong level). */
  files: FileOverlap[];
  /** Files with edits close by but not on the same lines (the weak level). Never lockfiles, changelogs, snapshots or generated files. */
  nearby: FileNearby[];
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
/** Edits this close, without touching the same place, count as nearby: a list one PR copies and the other changes sits a few lines apart. */
export const NEARBY_MARGIN = 10;

const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', 'Gemfile.lock']);
const GENERATED_MARKERS = ['/generated/', '.generated.', '.gen.', '.pb.go', '_pb2.py', '.min.js', '.min.css'];

/**
 * Files two PRs often touch without anything being wrong: lockfiles,
 * changelogs, snapshots and generated files. Left out of the nearby level
 * only; the same lines of them are still reported.
 */
export function isNoisyPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (LOCKFILES.has(name) || name.toUpperCase().startsWith('CHANGELOG')) {
    return true;
  }
  if (path.includes('__snapshots__/') || name.endsWith('.snap')) {
    return true;
  }
  return GENERATED_MARKERS.some((marker) => `/${path}`.includes(marker));
}

/** Zero-width insertion: written with its end below its start. */
function isInsertion(range: LineRange): boolean {
  return range.end < range.start;
}

/** The lines a range touches: an insertion before line n touches lines n-1 and n. */
function footprint(range: LineRange): LineRange {
  return isInsertion(range) ? { start: Math.max(1, range.start - 1), end: range.start } : range;
}

/** The range as the lines it names: an insertion is its one position. */
function extent(range: LineRange): LineRange {
  return isInsertion(range) ? { start: range.start, end: range.start } : range;
}

/** Ranges that overlap or touch joined, sorted. Insertions stay single positions, once each. */
function joinRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const joined: LineRange[] = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    if (last === undefined) {
      joined.push({ ...range });
    } else if (isInsertion(range) || isInsertion(last)) {
      if (range.start !== last.start || range.end !== last.end) {
        joined.push({ ...range });
      }
    } else if (range.start <= last.end + 1) {
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
 * insertion is a zero-width position before the old line it lands in front
 * of, so every insertion takes part in the comparison.
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
      ranges.push({ start: blockStart, end: blockStart - 1 });
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

/** Do the two ranges touch, or lie within `margin` lines of each other? */
function isNear(a: LineRange, b: LineRange, margin: number): boolean {
  const left = footprint(a);
  const right = footprint(b);
  return left.start <= right.end + margin && right.start <= left.end + margin;
}

/** Regions where a range of one list is within `margin` lines of a range of the other. */
function nearRegions(a: LineRange[], b: LineRange[], margin: number): LineRange[] {
  const regions: LineRange[] = [];
  for (const left of a) {
    for (const right of b) {
      if (isNear(left, right, margin)) {
        const l = footprint(left);
        const r = footprint(right);
        regions.push({ start: Math.min(l.start, r.start), end: Math.max(l.end, r.end) });
      }
    }
  }
  return joinRanges(regions);
}

/** From the first to the last line of the ranges. */
function spanOf(ranges: LineRange[]): LineRange {
  const lines = ranges.map(extent);
  return { start: Math.min(...lines.map((r) => r.start)), end: Math.max(...lines.map((r) => r.end)) };
}

/** The close edits of both PRs in one file, as one span each; null when none are close. */
function nearbyIn(path: string, mine: LineRange[], theirs: LineRange[], margin: number): FileNearby | null {
  const myClose = mine.filter((range) => theirs.some((other) => isNear(range, other, margin)));
  const theirClose = theirs.filter((range) => mine.some((other) => isNear(range, other, margin)));
  if (myClose.length === 0) {
    return null;
  }
  return { path, theirs: spanOf(theirClose), mine: spanOf(myClose) };
}

/** Same-line overlaps and nearby edits in the files two PRs both edit. */
function overlapOfPair(mine: Map<string, LineRange[]>, other: PrEdits, margin: number, nearbyMargin: number): { files: FileOverlap[]; nearby: FileNearby[] } {
  const files: FileOverlap[] = [];
  const nearby: FileNearby[] = [];
  for (const file of other.files) {
    const ranges = mine.get(file.path);
    if (ranges === undefined) {
      continue;
    }
    const regions = nearRegions(ranges, file.ranges, margin);
    if (regions.length > 0) {
      files.push({ path: file.path, regions });
    } else if (!isNoisyPath(file.path)) {
      const close = nearbyIn(file.path, ranges, file.ranges, nearbyMargin);
      if (close !== null) {
        nearby.push(close);
      }
    }
  }
  return { files, nearby };
}

/**
 * Which open PRs edit the same lines, or close to them, per PR. Only PRs in
 * one repo and on one base branch are compared (line numbers mean the same
 * file there), and `sameStack` pairs are skipped: a stack's layers overlap
 * by design. PRs are indexed by file path first, so only PRs that share a
 * file are compared line by line.
 */
export function findOverlaps(
  prs: PrEdits[],
  sameStack: (a: PrKey, b: PrKey) => boolean,
  margin: number = OVERLAP_MARGIN,
  nearbyMargin: number = NEARBY_MARGIN,
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

  // Per ordered pair, the files found so far: a pair shares several files, each in its own bucket.
  const pairs = new Map<string, { a: PrKey; b: PrKey; files: FileOverlap[]; nearby: FileNearby[]; otherCapped: boolean }>();
  for (const [id, sharing] of byFile) {
    const path = id.slice(id.lastIndexOf('\n') + 1);
    for (const a of sharing) {
      const mine = new Map(a.files.map((file) => [file.path, file.ranges]));
      for (const b of sharing) {
        if (a.prKey === b.prKey || sameStack(a.prKey, b.prKey)) {
          continue;
        }
        const found = overlapOfPair(mine, { ...b, files: b.files.filter((file) => file.path === path) }, margin, nearbyMargin);
        if (found.files.length === 0 && found.nearby.length === 0) {
          continue;
        }
        const pairId = `${a.prKey}\n${b.prKey}`;
        const pair = pairs.get(pairId) ?? { a: a.prKey, b: b.prKey, files: [], nearby: [], otherCapped: b.capped };
        pair.files.push(...found.files);
        pair.nearby.push(...found.nearby);
        pairs.set(pairId, pair);
      }
    }
  }

  const result = new Map<PrKey, PrOverlap[]>();
  for (const pair of pairs.values()) {
    const list = result.get(pair.a) ?? [];
    list.push({ other: pair.b, files: pair.files, nearby: pair.nearby, otherCapped: pair.otherCapped });
    result.set(pair.a, list);
  }
  for (const list of result.values()) {
    list.sort((x, y) => x.other.localeCompare(y.other));
  }
  return result;
}
