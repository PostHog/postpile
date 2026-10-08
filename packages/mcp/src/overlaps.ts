import { NEARBY_MARGIN, type FileNearby, type LineRange, type PrKey, type PrOverlap, type PrOverlapsView } from '@postpile/core';

/** Other PRs named in a pr_context answer and in a queue row. */
const MAX_OVERLAPS_SHOWN = 5;
const MAX_MARKERS_SHOWN = 3;

function rangeText(range: LineRange): string {
  return range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
}

/** "619–633" or "627": bare numbers, for the nearby wording. */
function spanText(range: LineRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`;
}

/** "path lines 600–640, line 700", per file joined with "; ". */
function filesText(overlap: PrOverlap): string {
  return overlap.files.map((file) => `${file.path} ${file.regions.map(rangeText).join(', ')}`).join('; ');
}

/** "path (619–633 vs 627)": the other PR's close edits against the asked PR's. */
function nearbyText(nearby: FileNearby[]): string {
  return nearby.map((file) => `${file.path} (${spanText(file.theirs)} vs ${spanText(file.mine)})`).join('; ');
}

/** "#1977": the number, as an overlap is always with a PR of the same repo. */
function shortRef(key: PrKey): string {
  return key.slice(key.lastIndexOf('#'));
}

/**
 * pr_context lines, for the fenced data: one per other open PR that edits the
 * same lines, and one per PR that edits close by. `authorOf` names the other
 * PR's author when it is stored.
 */
export function overlapLines(view: PrOverlapsView, key: PrKey, authorOf: Map<PrKey, string>): string[] {
  const overlaps = view.overlaps[key] ?? [];
  const lines: string[] = [];
  for (const overlap of overlaps.slice(0, MAX_OVERLAPS_SHOWN)) {
    const author = authorOf.get(overlap.other);
    const who = `${overlap.other}${author ? ` by ${author}` : ''}`;
    const capped = overlap.otherCapped ? ' (its diff is capped, it may overlap more)' : '';
    if (overlap.files.length > 0) {
      lines.push(`Also edits the same lines: ${who}, ${filesText(overlap)}${capped}`);
    }
    if (overlap.nearby.length > 0) {
      lines.push(`Also edits nearby lines: ${who}, ${nearbyText(overlap.nearby)}${overlap.files.length > 0 ? '' : capped}`);
    }
  }
  if (overlaps.length > MAX_OVERLAPS_SHOWN) {
    lines.push(`${overlaps.length - MAX_OVERLAPS_SHOWN} more open PRs edit the same or nearby lines.`);
  }
  return lines;
}

/** Outside the fence: what an overlap means, and that a capped diff leaves some unseen. */
export function overlapNotes(view: PrOverlapsView, key: PrKey): string[] {
  const overlaps = view.overlaps[key] ?? [];
  const notes: string[] = [];
  if (overlaps.some((overlap) => overlap.files.length > 0)) {
    notes.push('Overlapping edits: the merge shows no conflict, but both PRs change the same block (line numbers are on the base branch). Whichever merges second can drop or undo lines of the first; look at both before merging.');
  }
  if (overlaps.some((overlap) => overlap.nearby.length > 0)) {
    notes.push(`Nearby edits: within ${NEARBY_MARGIN} base lines of each other, no line in common. Not a conflict, but one PR may copy or rely on what the other changes (a list, a block of config); worth a look.`);
  }
  if (view.capped.includes(key)) {
    notes.push('May overlap more (diff capped): GitHub left some of this PR’s files or patches out, so the overlap check saw only part of it.');
  }
  return notes;
}

function markerList(label: string, keys: PrKey[]): string {
  if (keys.length === 0) {
    return '';
  }
  const shown = keys.slice(0, MAX_MARKERS_SHOWN).map(shortRef);
  const more = keys.length > MAX_MARKERS_SHOWN ? ` +${keys.length - MAX_MARKERS_SHOWN} more` : '';
  return ` · ${label} ${shown.join(', ')}${more}`;
}

/**
 * A short marker for a queue row: " · overlaps #1977" for the same lines,
 * " · near #1980" for close edits only, or "" when none. Numbers only, no
 * text from GitHub.
 */
export function overlapMarker(view: PrOverlapsView, key: PrKey): string {
  const overlaps = view.overlaps[key] ?? [];
  const same = overlaps.filter((overlap) => overlap.files.length > 0).map((overlap) => overlap.other);
  const near = overlaps.filter((overlap) => overlap.files.length === 0).map((overlap) => overlap.other);
  return markerList('overlaps', same) + markerList('near', near);
}
