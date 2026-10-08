import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { errorText } from './errors.ts';
import type { GitHubQuota } from './github-quota.ts';

/** PRs whose diff is read per full sync. */
export const DIFF_SYNC_PRS = 30;
/** PRs whose diff is read per live poll: it runs every minute, so it takes fewer. */
export const DIFF_POLL_PRS = 5;

/**
 * Reads which lines open PRs edit (DESIGN.md "Overlapping edits"), so
 * `findOverlaps` can say that two PRs touch the same block of a file. One
 * REST request per PR whose stored diff is missing or was read at another
 * head or base; PRs that are alone in their repo and base branch are left
 * alone, as nothing could overlap. At most `budget` PRs per run, newest
 * first, and nothing while the GitHub quota is low. A failed request ends
 * the pass: the PR keeps no diff and the next run tries again. Never throws.
 */
export class DiffReader {
  constructor(
    private readonly reader: GitHubReader,
    private readonly store: Store,
    private readonly quota: GitHubQuota,
    private readonly now: () => Date,
    private readonly textLog: (line: string) => void,
  ) {}

  async run(origin: 'sync' | 'poll', budget: number): Promise<void> {
    const wanted = this.store.prDiffs.openWithoutCurrentDiff();
    const picked = wanted.slice(0, budget);
    if (wanted.length > picked.length) {
      this.textLog(`${origin}: diffs of ${wanted.length - picked.length} open PRs wait for the next run`);
    }
    for (const { key, repo, number, headOid, baseRef } of picked) {
      // Checked before each PR: the requests of the ones before may have used up the quota.
      if (!this.quota.allowsBackground()) {
        this.textLog(`${origin}: diffs skipped, GitHub quota low`);
        return;
      }
      // The head and base are the ones from before the request: a push meanwhile makes the diff stale, and the next run reads it again.
      try {
        const read = await this.reader.readPrDiff({ repo, number });
        this.store.prDiffs.replace(key, { headOid, baseRef, capped: read.capped, files: read.files, fetchedAt: this.now().toISOString() });
      } catch (error) {
        this.textLog(`${origin}: diff of ${key} failed, the rest wait for the next run: ${errorText(error)}`);
        return;
      }
    }
  }
}
