export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Lines of a text, without the empty one a trailing newline would add. */
function linesOf(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

/**
 * Line diff from before to after, via the longest common subsequence.
 * Instructions files are a few hundred lines at most, so the plain
 * quadratic table is fine.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  // common[i][j]: length of the LCS of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      result.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      result.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    result.push({ kind: 'removed', text: a[i]! });
  }
  for (; j < b.length; j += 1) {
    result.push({ kind: 'added', text: b[j]! });
  }
  return result;
}

/** "+2 −1", for a version history row. */
export function diffCounts(lines: DiffLine[]): string {
  const added = lines.filter((line) => line.kind === 'added').length;
  const removed = lines.filter((line) => line.kind === 'removed').length;
  return `+${added} −${removed}`;
}

/** Changed lines with this many unchanged lines of context around them; the rest collapse into one gap. */
export function withContext(lines: DiffLine[], context: number): (DiffLine | { kind: 'gap'; count: number })[] {
  const keep = lines.map((line, index) =>
    lines.slice(Math.max(0, index - context), index + context + 1).some((near) => near.kind !== 'same') || line.kind !== 'same',
  );
  const result: (DiffLine | { kind: 'gap'; count: number })[] = [];
  lines.forEach((line, index) => {
    if (keep[index]) {
      result.push(line);
      return;
    }
    const last = result.at(-1);
    if (last?.kind === 'gap') {
      last.count += 1;
    } else {
      result.push({ kind: 'gap', count: 1 });
    }
  });
  return result;
}
