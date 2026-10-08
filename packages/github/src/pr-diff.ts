import { changedRanges, type FileEdits, type PrRef } from '@postpile/core';
import type { GitHubHttp } from './http.ts';

/** Files per page, GitHub's maximum. */
const FILES_PER_PAGE = 100;
/** Pages read per PR. A PR with more files than this is marked capped (GitHub itself stops at 3000). */
export const DIFF_MAX_PAGES = 10;

/** The line ranges one PR edits, as the diff pass reads them. */
export interface PrDiffRead {
  files: FileEdits[];
  /** Files were left unread (more pages than read) or GitHub left a patch out (very large files). */
  capped: boolean;
}

interface RawDiffFile {
  filename: string;
  previous_filename?: string;
  status: string;
  changes: number;
  patch?: string;
}

/**
 * The lines a PR edits, from the REST file list (GraphQL has no patches).
 * Only ranges leave this function: the patch text is parsed and dropped.
 * A renamed file is keyed by its old path, which is where other PRs edit
 * it; an added file has no base lines and is left out. A changed file
 * without a patch is a diff GitHub cut short, so the read is marked capped
 * (a binary file has no changes to count and is not).
 */
export async function readPrDiff(http: GitHubHttp, ref: PrRef): Promise<PrDiffRead> {
  const files: FileEdits[] = [];
  let capped = false;
  for (let page = 1; page <= DIFF_MAX_PAGES; page += 1) {
    const response = await http.requestOk('GET', `repos/${ref.repo}/pulls/${ref.number}/files?per_page=${FILES_PER_PAGE}&page=${page}`);
    const raw = (await response.json()) as RawDiffFile[];
    for (const file of raw) {
      if (file.status === 'added') {
        continue;
      }
      if (file.patch === undefined) {
        capped = capped || file.changes > 0;
        continue;
      }
      files.push({ path: file.previous_filename ?? file.filename, ranges: changedRanges(file.patch) });
    }
    if (raw.length < FILES_PER_PAGE) {
      return { files, capped };
    }
  }
  return { files, capped: true };
}
