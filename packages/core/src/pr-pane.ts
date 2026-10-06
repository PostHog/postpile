// What the PR pane reads of a PR (`PrDetail.pr`). The stored `Pr` holds every
// comment, thread, commit and timeline item; the pane shows none of them
// directly. Its activity list, reply and react targets come
// from core's `activityList` on `PrDetail.activity`, built from the stored
// PR before the slim view is made. MCP `pr_context` and the CLI read the
// same view. Rules only, no IO.
import { isCarrierReview } from './carrier-reviews.ts';
import type { IsoTime, Pr, PrFile, PrKey, PrRef, PrState, Review, ReviewDecision } from './types.ts';

/** A review as the pane reads it: who, which state, when. Review text shows in the activity list. */
export type PaneReview = Pick<Review, 'author' | 'state' | 'submittedAt'>;

export interface PrPaneView {
  key: PrKey;
  /** The number goes into "About #1907: " when the glance opens the agent pane. */
  ref: PrRef;
  title: string;
  /** "Open on GitHub", its menu and the key files' links start from it. */
  url: string;
  /** The PR description, whole: the pane folds it and Expand shows it all. */
  body: string;
  author: string;
  /** Assigned users' logins; empty when none (or not fetched yet). */
  assignees: string[];
  state: PrState;
  isDraft: boolean;
  baseRef: string;
  headRef: string;
  /** Approve and Comment review are pinned to it; "Approve again" compares the approval's commit with it. */
  headOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** The changed files with their counts (the query takes the first 100): the glance's key files read their +/- here. */
  files: PrFile[];
  reviewDecision: ReviewDecision;
  /** Still-pending review requests: user logins. */
  reviewerUsers: string[];
  /** Still-pending review requests: "org/team-slug". */
  reviewerTeams: string[];
  /**
   * Who reviewed, in GitHub's order. Without the empty reviews GitHub makes
   * for thread replies (`isCarrierReview`): a reply is no review.
   */
  reviews: PaneReview[];
  /** The last stored commit's time ("pushed 2h"); null for a PR without commits in the snapshot. */
  lastCommitAt: IsoTime | null;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  mergedAt: IsoTime | null;
  mergedBy: string | null;
}

/** The slim PR the pane, MCP `pr_context` and the CLI read. Copies field by field, so nothing stored rides along. */
export function prPaneView(pr: Pr): PrPaneView {
  const lastCommit = pr.commits[pr.commits.length - 1];
  return {
    key: pr.key,
    ref: { repo: pr.ref.repo, number: pr.ref.number },
    title: pr.title,
    url: pr.url,
    body: pr.body,
    author: pr.author,
    assignees: pr.assignees ?? [],
    state: pr.state,
    isDraft: pr.isDraft,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    headOid: pr.headOid,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    files: pr.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
    reviewDecision: pr.reviewDecision,
    reviewerUsers: pr.reviewerUsers,
    reviewerTeams: pr.reviewerTeams,
    reviews: pr.reviews
      .filter((review) => !isCarrierReview(review, pr))
      .map((review) => ({ author: review.author, state: review.state, submittedAt: review.submittedAt })),
    lastCommitAt: lastCommit ? lastCommit.committedAt : null,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    mergedBy: pr.mergedBy,
  };
}
