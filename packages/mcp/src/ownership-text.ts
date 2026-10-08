// Review ownership and effort, as the MCP answers say them (DESIGN.md
// "Review ownership"). File paths come from GitHub: these lines go inside
// the <postpile-data> fence.
import { fileLines, type PrFile, type ReviewOwnership } from '@postpile/core';
import { teamSlug } from './text.ts';

/** Brief answers name this many paths per team, then "+N more". */
const PATHS_SHOWN = 3;

/** The PR's size as GitHub counts it. */
export interface PrSize {
  additions: number;
  deletions: number;
  changedFiles: number;
}

function files(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** "a.yml, b.yml, c.yml +2 more"; every path when `all`. */
function pathList(owned: PrFile[], all: boolean): string {
  const shown = all ? owned : owned.slice(0, PATHS_SHOWN);
  const more = owned.length - shown.length;
  return `${shown.map((file) => file.path).join(', ')}${more > 0 ? ` +${more} more` : ''}`;
}

/** " (only the first 100 checked)" when GitHub's file list was capped, else empty. */
function cappedNote(ownership: ReviewOwnership): string {
  return ownership.filesListed < ownership.filesTotal ? ` (only the first ${ownership.filesListed} checked)` : '';
}

/**
 * pr_context: one line per requested or home team, "team-devex: 1 of 7
 * files (.github/workflows/ci.yml)". Brief names up to 3 paths, full all
 * of them. Empty when CODEOWNERS is unknown: nothing is guessed.
 */
export function ownershipLines(ownership: ReviewOwnership | null, all: boolean): string[] {
  if (!ownership || ownership.owners.length === 0) {
    return [];
  }
  const lines = [`Code owners (CODEOWNERS on the default branch)${cappedNote(ownership)}:`];
  for (const entry of ownership.owners) {
    const asked = entry.requested ? '' : ' (not requested)';
    const paths = entry.files.length > 0 ? ` (${pathList(entry.files, all)})` : '';
    lines.push(`  ${teamSlug(entry.owner)}${asked}: ${entry.files.length} of ${files(ownership.filesTotal)}${paths}`);
  }
  return lines;
}

/** whats_on_me: "team-devex owns 1 of 7 files, team-core owns 6 of 7 files"; empty when CODEOWNERS is unknown. */
export function ownershipShort(ownership: ReviewOwnership | null): string {
  if (!ownership || ownership.owners.length === 0) {
    return '';
  }
  const parts = ownership.owners.map((entry) => `${teamSlug(entry.owner)} owns ${entry.files.length} of ${files(ownership.filesTotal)}`);
  return `${parts.join(', ')}${cappedNote(ownership)}`;
}

/**
 * "effort: 1 file, +12 -3 in your team's area (PR +410 -120, 23 files); 2
 * open threads". The area part only when CODEOWNERS gives the user's teams
 * at least one file; the PR's size and the threads always.
 */
export function effortText(size: PrSize, ownership: ReviewOwnership | null, openThreads: number): string {
  const total = `PR +${size.additions} -${size.deletions}, ${files(size.changedFiles)}`;
  const threads = openThreads > 0 ? `; ${openThreads} open ${openThreads === 1 ? 'thread' : 'threads'}` : '';
  if (!ownership || ownership.yours.length === 0) {
    return `effort: ${total}${threads}`;
  }
  const lines = fileLines(ownership.yours);
  const area = `${files(ownership.yours.length)}, +${lines.additions} -${lines.deletions} in your team's area`;
  const capped = ownership.filesListed < ownership.filesTotal ? `, only the first ${ownership.filesListed} checked` : '';
  return `effort: ${area} (${total}${capped})${threads}`;
}
