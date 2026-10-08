import type { LineRange, PrKey, PrOverlap, PrOverlapsView } from '@postpile/core';

/** Other PRs named in a pr_context answer and in a queue row. */
const MAX_OVERLAPS_SHOWN = 5;
const MAX_MARKERS_SHOWN = 3;

function rangeText(range: LineRange): string {
  return range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
}

/** "path lines 600–640, line 700", per file joined with "; ". */
function filesText(overlap: PrOverlap): string {
  return overlap.files.map((file) => `${file.path} ${file.regions.map(rangeText).join(', ')}`).join('; ');
}

/** "#1977": the number, as an overlap is always with a PR of the same repo. */
function shortRef(key: PrKey): string {
  return key.slice(key.lastIndexOf('#'));
}

/**
 * pr_context lines, for the fenced data: one per other open PR that edits the
 * same lines. `authorOf` names the other PR's author when it is stored.
 */
export function overlapLines(view: PrOverlapsView, key: PrKey, authorOf: Map<PrKey, string>): string[] {
  const overlaps = view.overlaps[key] ?? [];
  const lines = overlaps.slice(0, MAX_OVERLAPS_SHOWN).map((overlap) => {
    const author = authorOf.get(overlap.other);
    const capped = overlap.otherCapped ? ' (its diff is capped, it may overlap more)' : '';
    return `Also edits the same lines: ${overlap.other}${author ? ` by ${author}` : ''}, ${filesText(overlap)}${capped}`;
  });
  if (overlaps.length > MAX_OVERLAPS_SHOWN) {
    lines.push(`${overlaps.length - MAX_OVERLAPS_SHOWN} more open PRs edit the same lines.`);
  }
  return lines;
}

/** Outside the fence: what an overlap means, and that a capped diff leaves some unseen. */
export function overlapNotes(view: PrOverlapsView, key: PrKey): string[] {
  const notes: string[] = [];
  if ((view.overlaps[key] ?? []).length > 0) {
    notes.push('Overlapping edits: git reports no conflict, but both PRs change the same block (line numbers are on the base branch). Whichever merges second can drop or undo lines of the first; look at both before merging.');
  }
  if (view.capped.includes(key)) {
    notes.push('May overlap more (diff capped): GitHub left some of this PR’s files or patches out, so the overlap check saw only part of it.');
  }
  return notes;
}

/** A short marker for a queue row: " · overlaps #1977, #1980", or "" when none. Numbers only, no text from GitHub. */
export function overlapMarker(view: PrOverlapsView, key: PrKey): string {
  const overlaps = view.overlaps[key] ?? [];
  if (overlaps.length === 0) {
    return '';
  }
  const shown = overlaps.slice(0, MAX_MARKERS_SHOWN).map((overlap) => shortRef(overlap.other));
  const more = overlaps.length > MAX_MARKERS_SHOWN ? ` +${overlaps.length - MAX_MARKERS_SHOWN} more` : '';
  return ` · overlaps ${shown.join(', ')}${more}`;
}
