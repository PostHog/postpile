/** Longest line quoted in a summary before it is cut. */
const SUMMARY_LINE_MAX = 90;

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Lines of `a` not in `b`, counted: a line twice in `a` and once in `b` is left once. */
function linesMissingFrom(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of b) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const line of a) {
    const count = left.get(line) ?? 0;
    if (count > 0) {
      left.set(line, count - 1);
    } else {
      missing.push(line);
    }
  }
  return missing;
}

function quoted(line: string): string {
  return line.length > SUMMARY_LINE_MAX ? `${line.slice(0, SUMMARY_LINE_MAX - 1).trimEnd()}…` : line;
}

/**
 * The version summary of a proposal the user edited before accepting: it
 * names what the saved text changed, in the user's wording, not the line
 * the agent proposed. "Added: <line> (your wording)" for one line, else
 * counts.
 */
export function editedInstructionsSummary(before: string, after: string): string {
  const oldLines = nonEmptyLines(before);
  const newLines = nonEmptyLines(after);
  const added = linesMissingFrom(newLines, oldLines);
  const removed = linesMissingFrom(oldLines, newLines);
  if (added.length === 1 && removed.length === 0) {
    return `Added: ${quoted(added[0]!)} (your wording)`;
  }
  if (added.length === 0 && removed.length === 1) {
    return `Removed: ${quoted(removed[0]!)} (your edit)`;
  }
  if (added.length === 1 && removed.length === 1) {
    return `Changed to: ${quoted(added[0]!)} (your wording)`;
  }
  if (added.length === 0 && removed.length === 0) {
    return 'Reordered lines (your edit)';
  }
  return `Your edit: ${added.length} ${added.length === 1 ? 'line' : 'lines'} added, ${removed.length} removed`;
}
