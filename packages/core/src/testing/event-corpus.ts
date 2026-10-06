// A corpus of who does what on a pull request, for table tests that pin how
// each kind of actor and comment travels through the pipeline: automation,
// loudness, memory role, the dossier delta, "newer events" and quiet reads
// (`event-roles.test.ts`, and the engine's bot noise scenario). Bot logins
// and the shape of their comments follow the real bots (trunk-io,
// coderabbitai, chatgpt-codex-connector, ...); people, repos, PR numbers and
// every body are invented.
import { at, makeComment, makeCommit, makePr, makeReview, makeThreadFor, makeTimelineItem } from '../fixtures.ts';
import { deriveEvents } from '../events.ts';
// Test helpers over the raw snapshot: every stored body (`FullPr`).
import type { FullComment as Comment, Commit, NotificationThread, FullPr as Pr, PrEvent, FullReview as Review, TimelineItem, Viewer } from '../types.ts';

/**
 * The viewer of every scenario: home team acme/team-platform, and
 * acme/approvers, a team that only routes reviews to them.
 */
export const CORPUS_VIEWER: Viewer = {
  login: 'viewer',
  teams: ['acme/team-platform', 'acme/approvers'],
  homeTeams: ['acme/team-platform'],
  teamMembers: ['lyra'],
};

/** When the viewer last read every scenario's thread on GitHub. Everything before it is seen. */
export const CORPUS_LAST_READ = at(25);

/** When the corpus activity happens: after the last read. */
export const CORPUS_AT = at(30);

/** Well after everything, so no time-based rule (a grace period) decides a quiet read. */
export const CORPUS_NOW = at(24 * 60);

/** Something GitHub shows on the PR: a comment or review body, a review, a timeline item or a commit. */
export type CorpusArtifact = { comment: Comment } | { review: Review } | { timeline: TimelineItem } | { commit: Commit };

export interface CorpusEntry {
  /** What happened, the way a person would say it. */
  says: string;
  /** Already on the PR before it (the comment a later edit changes). */
  before?: CorpusArtifact[];
  /** What is new on GitHub. A comment with an id already on the PR replaces it (an edit). */
  adds: CorpusArtifact[];
  /** PR fields that change with it, e.g. the state after a merge. */
  pr?: Partial<Pr>;
}

// --- Bodies -----------------------------------------------------------------

// Trunk's sticky comment as trunk writes it (DESIGN.md "Merge queue"): the
// marker, then one status line that replaces the last; an en space after the
// emoji. Only the first one, before submitting, has the merge checkbox.
const TRUNK_MARKER = '<!-- Trunk Merge -->';
const TRUNK_HEADER = 'Merging to `master` in this repository is managed by Trunk.';
const TRUNK_CHECKBOX = 'To merge this pull request, check the box to the left or comment `/trunk merge` below.';

function trunkBody(state: string): string {
  return `${TRUNK_MARKER}\n${state}`;
}

function trunkOffer(box: '[ ]' | '[x]'): string {
  return trunkBody(`${TRUNK_HEADER}\n\n<!-- Start PR Submit Checkbox -->\n- ${box} <!-- End PR Submit Checkbox -->${TRUNK_CHECKBOX}`);
}

const TRUNK_NOT_SUBMITTED = trunkOffer('[ ]');

/** Trunk's sticky comment as it was posted, before any edit. */
function trunkSticky(): Comment {
  return makeComment({ id: 'c-trunk', author: 'trunk-io[bot]', body: TRUNK_NOT_SUBMITTED, createdAt: at(12) });
}

/** Trunk refreshing its sticky comment to a new queue state. */
function trunkEdit(state: string): CorpusEntry['adds'] {
  return [{ comment: { ...trunkSticky(), body: trunkBody(state), lastEditedAt: CORPUS_AT, editor: 'trunk-io[bot]' } }];
}

const CODERABBIT_SUMMARY = `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
## Walkthrough

The runner setup moves from the shared pool to dedicated machines. The retry helper gains a backoff.

## Changes

| File | Summary |
| --- | --- |
| \`ci/runners.ts\` | Dedicated runner pool |`;

function coderabbitSummary(): Comment {
  return makeComment({ id: 'c-rabbit-summary', author: 'coderabbitai[bot]', body: CODERABBIT_SUMMARY, createdAt: at(12) });
}

function deployComment(): Comment {
  return makeComment({
    id: 'c-deploy',
    author: 'deployment-status-posthog',
    body: '🚀 Preview deployment is building for 4f3c2a1.',
    createdAt: at(12),
  });
}

function bundleReport(): Comment {
  return makeComment({
    id: 'c-bundle',
    author: 'github-actions[bot]',
    body: '📦 Bundle size report\n\n`frontend/main.js`: +1.2 kB (0.3%)',
    createdAt: at(12),
  });
}

/** A bot review: the review itself, and its body as GitHub lists it among the comments. */
function botReview(id: string, author: string, state: Review['state'], body: string): CorpusArtifact[] {
  const review = makeReview({ id, author, state, body, submittedAt: CORPUS_AT });
  const comment = makeComment({ id: `${id}-body`, author, body, createdAt: CORPUS_AT, kind: 'review' });
  return [{ review }, { comment }];
}

/** A person's review, with its body among the comments when it has one. */
function personReview(id: string, author: string, state: Review['state'], body: string): CorpusArtifact[] {
  const review: CorpusArtifact = { review: makeReview({ id, author, state, body, submittedAt: CORPUS_AT }) };
  if (body === '') {
    return [review];
  }
  return [review, { comment: makeComment({ id: `${id}-body`, author, body, createdAt: CORPUS_AT, kind: 'review' }) }];
}

function comment(id: string, author: string, body: string): CorpusArtifact {
  return { comment: makeComment({ id, author, body, createdAt: CORPUS_AT }) };
}

function timeline(id: string, kind: TimelineItem['kind'], actor: string, subject: string | null = null): CorpusArtifact {
  return { timeline: makeTimelineItem({ id, kind, actor, subject, at: CORPUS_AT }) };
}

const MERGED: Partial<Pr> = { state: 'MERGED', mergedAt: CORPUS_AT };

// --- The corpus -------------------------------------------------------------

/**
 * Every entry, by name. Entries are not tied to a scenario: the same trunk
 * edit lands on the viewer's own PR and on a PR they review.
 */
export const CORPUS = {
  // trunk-io, the merge queue: one sticky comment it keeps editing, a test badge, and the merge itself.
  trunkSticky: {
    says: 'trunk-io posts its "managed by Trunk" comment with the merge checkbox',
    adds: [{ comment: { ...trunkSticky(), createdAt: CORPUS_AT } }],
  },
  trunkSubmitted: {
    says: 'trunk-io edits its comment: "✨ Submitted to Merge by @viewer"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit('✨\u2002Submitted to Merge by Viewer Example (@viewer). It will be added to the merge queue once all branch protection rules pass.'),
  },
  trunkWaiting: {
    says: 'trunk-io edits its comment: "⏳ Waiting to start tests"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit('⏳\u2002Waiting to start tests on this pull request - [details](https://app.trunk.io/acme/merge/app/4411)'),
  },
  trunkTesting: {
    says: 'trunk-io edits its comment: "🧪 Running tests on this pull request (testing on PR #4412)"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit('🧪\u2002Running tests on this pull request (testing on PR [#4412](https://github.com/acme/app/pull/4412)) - [details](https://app.trunk.io/acme/merge/app/4411).'),
  },
  trunkStackTesting: {
    says: 'trunk-io edits its comment on a stack layer: "🧪 Running tests on this stack (testing on PR #4413)"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit('🧪\u2002Running tests on this stack (testing on PR [#4413](https://github.com/acme/app/pull/4413)) - [details](https://app.trunk.io/acme/merge/app/4411).'),
  },
  trunkMergedComment: {
    says: 'trunk-io edits its comment: "😎 Merged successfully"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit('😎\u2002Merged successfully - [details](https://app.trunk.io/acme/merge/app/4411).'),
  },
  trunkRemoved: {
    says: 'trunk-io edits its comment: "🚫 removed from the merge queue because it waited too long to become mergeable"',
    before: [{ comment: trunkSticky() }],
    adds: trunkEdit(
      "🚫\u2002This pull request was removed from the merge queue because it was waiting to become mergeable for too long (for example: missing required approvals or checks, or a merge conflict). Submit it again once it's ready to merge.",
    ),
  },
  trunkStackFailed: {
    says: 'trunk-io comments: "Stacked PR 4410 failed testing in the merge queue"',
    before: [{ comment: trunkSticky() }],
    adds: [
      comment(
        'c-trunk-stack',
        'trunk-io[bot]',
        'Stacked PR [4410](https://github.com/acme/app/pull/4410) failed testing in the merge queue. Please investigate the failure and re-submit the stack.',
      ),
    ],
  },
  trunkStackCancelled: {
    says: 'trunk-io comments: "Stacked PR 4410 was cancelled: a user cancelled it"',
    before: [{ comment: trunkSticky() }],
    adds: [comment('c-trunk-cancel', 'trunk-io[bot]', 'Stacked PR [4410](https://github.com/acme/app/pull/4410) was cancelled: a user cancelled it.')],
  },
  trunkTestBadge: {
    says: 'trunk-io posts its Test Analytics badge comment',
    adds: [
      comment(
        'c-trunk-tests',
        'trunk-io[bot]',
        '<!-- Trunk Test Analytics -->\n<sub>\n\n![2 flaky tests](https://img.shields.io/badge/flaky-2-yellow) 412 tests ran, 2 flaky, 0 quarantined.\n</sub>',
      ),
    ],
  },
  trunkMerges: {
    says: 'trunk-io merges the PR',
    adds: [timeline('tl-trunk-merged', 'merged', 'trunk-io[bot]')],
    pr: { ...MERGED, mergedBy: 'trunk-io[bot]' },
  },
  trunkCloses: {
    says: 'trunk-io closes the PR after the stack below it merged',
    adds: [timeline('tl-trunk-closed', 'closed', 'trunk-io[bot]')],
    pr: { state: 'CLOSED' },
  },
  trunkRequestsReview: {
    says: 'trunk-io requests a review from lyra',
    adds: [timeline('tl-trunk-rr', 'review_requested', 'trunk-io[bot]', 'lyra')],
    pr: { reviewerUsers: ['lyra'] },
  },
  viewerTicksTrunkBox: {
    says: "the viewer ticks the merge box in trunk-io's comment (an edit by the viewer)",
    before: [{ comment: trunkSticky() }],
    adds: [{ comment: { ...trunkSticky(), body: trunkOffer('[x]'), lastEditedAt: CORPUS_AT, editor: 'viewer' } }],
  },
  githubQueueRemoves: {
    says: "GitHub's merge queue removes the PR",
    adds: [timeline('tl-queue-removed', 'removed_from_merge_queue', 'github-merge-queue[bot]')],
  },

  // Deploys.
  deployComment: {
    says: 'deployment-status-posthog posts "Preview deployment is building"',
    adds: [{ comment: { ...deployComment(), createdAt: CORPUS_AT } }],
  },
  deployEdit: {
    says: 'deployment-status-posthog edits its comment to "Deployed to preview"',
    before: [{ comment: deployComment() }],
    adds: [
      {
        comment: {
          ...deployComment(),
          body: '✅ Deployed to preview: https://pr-4411.preview.acme.dev (4f3c2a1)',
          lastEditedAt: CORPUS_AT,
          editor: 'deployment-status-posthog',
        },
      },
    ],
  },
  deployTimeline: {
    says: 'github-actions deploys the branch to the preview environment',
    adds: [timeline('tl-deployed', 'deployed', 'github-actions[bot]')],
  },

  // github-actions comments.
  githubActionsReport: {
    says: 'github-actions posts a bundle size report',
    adds: [{ comment: { ...bundleReport(), createdAt: CORPUS_AT } }],
  },
  githubActionsReportEdit: {
    says: 'github-actions edits its bundle size report after a push',
    before: [{ comment: bundleReport() }],
    adds: [{ comment: { ...bundleReport(), body: '📦 Bundle size report\n\n`frontend/main.js`: +0.4 kB (0.1%)', lastEditedAt: CORPUS_AT, editor: 'github-actions[bot]' } }],
  },
  githubActionsMigrationWarning: {
    says: 'github-actions warns that a migration locks a big table',
    adds: [comment('c-gha-migration', 'github-actions[bot]', '⚠️ Migration check: `0412_add_index` locks `events` while it runs. Ask #team-infra before merging.')],
  },

  // Review bots.
  coderabbitReview: {
    says: 'coderabbitai reviews: "Actionable comments posted: 2"',
    adds: botReview(
      'r-rabbit',
      'coderabbitai[bot]',
      'COMMENTED',
      '**Actionable comments posted: 2**\n\n<details><summary>🧹 Nitpick comments (1)</summary>\n\n`ci/retry.ts`: the backoff never resets after a success.\n</details>',
    ),
  },
  coderabbitSummaryEdit: {
    says: 'coderabbitai refreshes its walkthrough summary after a push',
    before: [{ comment: coderabbitSummary() }],
    adds: [{ comment: { ...coderabbitSummary(), body: `${CODERABBIT_SUMMARY}\n| \`ci/retry.ts\` | Backoff resets after success |`, lastEditedAt: CORPUS_AT, editor: 'coderabbitai[bot]' } }],
  },
  codexFindings: {
    says: 'chatgpt-codex-connector reviews with a P1 and a P2 finding',
    adds: botReview(
      'r-codex',
      'chatgpt-codex-connector[bot]',
      'COMMENTED',
      '### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n- **P1** The retry loop never gives up when the runner pool is empty.\n- **P2** `maxAttempts` is read before the config is loaded.',
    ),
  },
  codexNoIssues: {
    says: 'chatgpt-codex-connector says "Didn\'t find any major issues"',
    adds: [comment('c-codex-ok', 'chatgpt-codex-connector[bot]', "Codex Review: Didn't find any major issues. Swish! 🏀")],
  },
  greptileReview: {
    says: 'greptile-apps reviews with its summary and a confidence score',
    adds: botReview(
      'r-greptile',
      'greptile-apps[bot]',
      'COMMENTED',
      '**Greptile Summary**\n\nMoves CI runners to a dedicated pool and adds a retry backoff.\n\nConfidence score: 4/5',
    ),
  },
  copilotReview: {
    says: 'copilot-pull-request-reviewer posts its pull request overview',
    adds: botReview(
      'r-copilot',
      'copilot-pull-request-reviewer[bot]',
      'COMMENTED',
      '## Pull Request Overview\n\nThis PR moves CI runners to a dedicated pool.\n\nReviewed 3 out of 3 changed files in this pull request and generated 1 comment.',
    ),
  },
  securityBotComment: {
    says: 'posthog-security-review-bot reports no findings',
    adds: [comment('c-security', 'posthog-security-review-bot', '🔒 Security review: no issues found in the 3 changed files.')],
  },
  stamphogNotYet: {
    says: 'stamphog says "Not approved yet — waiting on the codex review"',
    adds: [comment('c-stamphog', 'stamphog[bot]', 'Not approved yet — waiting on the codex review and a green CI run before stamping.')],
  },
  stamphogApproves: {
    says: 'stamphog approves',
    adds: botReview('r-stamphog', 'stamphog[bot]', 'APPROVED', 'Stamped: small change, agent reviews clean, CI green.'),
    pr: { reviewDecision: 'APPROVED' },
  },
  veriaComment: {
    says: 'veria-ai reports a potential issue',
    adds: [comment('c-veria', 'veria-ai', 'Veria found 1 potential issue: an unvalidated redirect in `login.ts`.')],
  },

  // Requests and bot-authored PRs.
  assignerRequestsTeam: {
    says: 'pr-assigner-resolver-posthog requests a review from acme/approvers',
    adds: [timeline('tl-assigner', 'review_requested', 'pr-assigner-resolver-posthog', 'acme/approvers')],
    pr: { reviewerTeams: ['acme/approvers'] },
  },
  dependabotRebases: {
    says: 'dependabot force-pushes a rebase of its PR',
    adds: [timeline('tl-dependabot-push', 'head_ref_force_pushed', 'dependabot[bot]')],
  },
  dependabotComment: {
    says: 'dependabot comments that the dependency is up to date now',
    adds: [comment('c-dependabot', 'dependabot[bot]', 'Looks like vite is up-to-date now, so this is no longer needed.')],
  },
  agentPushes: {
    says: 'posthog[bot] pushes a fix to the PR it opened for the viewer',
    adds: [{ commit: makeCommit({ oid: 'agent-fix', headline: 'fix: address review feedback', author: 'posthog[bot]', committedAt: CORPUS_AT }) }],
  },
  agentMarksReady: {
    says: 'posthog[bot] marks its draft ready for review',
    adds: [timeline('tl-agent-ready', 'ready_for_review', 'posthog[bot]')],
    pr: { isDraft: false },
  },

  // The viewer.
  viewerComments: {
    says: 'the viewer comments',
    adds: [comment('c-viewer', 'viewer', 'Pushed a fix for the flaky test, PTAL.')],
  },
  viewerPushes: {
    says: 'the viewer pushes a commit',
    adds: [{ commit: makeCommit({ oid: 'viewer-fix', headline: 'Fix flaky runner test', author: 'viewer', committedAt: CORPUS_AT }) }],
  },
  viewerApproves: {
    says: 'the viewer approves',
    adds: personReview('r-viewer', 'viewer', 'APPROVED', ''),
  },
  viewerMerges: {
    says: 'the viewer merges',
    adds: [timeline('tl-viewer-merged', 'merged', 'viewer')],
    pr: { ...MERGED, mergedBy: 'viewer' },
  },
  viewerQueues: {
    says: 'the viewer adds the PR to the merge queue',
    adds: [timeline('tl-viewer-queued', 'added_to_merge_queue', 'viewer')],
  },

  // People.
  teammateComments: {
    says: 'lyra (a teammate) comments',
    adds: [comment('c-lyra', 'lyra', 'Nice, this also fixes the cache miss we saw last week.')],
  },
  teammateAsksViewer: {
    says: 'lyra asks the viewer a question',
    adds: [comment('c-lyra-ask', 'lyra', '@viewer could you double check the retry limit here?')],
  },
  teammateMentionsViewer: {
    says: 'lyra mentions the viewer without asking',
    adds: [comment('c-lyra-fyi', 'lyra', 'cc @viewer, this is the runner change from standup.')],
  },
  teamMentioned: {
    says: "ada mentions the viewer's team",
    adds: [comment('c-ada-team', 'ada', '@acme/team-platform heads up, this changes the runner image.')],
  },
  routingTeamMentioned: {
    says: 'ada mentions acme/approvers, a team that only routes reviews to the viewer',
    adds: [comment('c-ada-routing', 'ada', '@acme/approvers this one is ready for a look.')],
  },
  authorRepliesInThread: {
    says: "the author replies to the viewer's inline comment",
    before: [{ comment: makeComment({ id: 'c-viewer-inline', author: 'viewer', body: 'Should this be configurable?', createdAt: at(15), kind: 'review_comment', threadId: 'th-1', path: 'ci/retry.ts' }) }],
    adds: [{ comment: makeComment({ id: 'c-author-reply', author: 'alice', body: 'Good point, made it a setting.', createdAt: CORPUS_AT, kind: 'review_comment', threadId: 'th-1', path: 'ci/retry.ts' }) }],
  },
  personEditsComment: {
    says: 'ada edits her own comment to fix a typo',
    before: [{ comment: makeComment({ id: 'c-ada-old', author: 'ada', body: 'This should hepl with cold starts.', createdAt: at(12) }) }],
    adds: [{ comment: makeComment({ id: 'c-ada-old', author: 'ada', body: 'This should help with cold starts.', createdAt: at(12), lastEditedAt: CORPUS_AT, editor: 'ada' }) }],
  },
  reviewerApproves: {
    says: 'ada approves',
    adds: personReview('r-ada', 'ada', 'APPROVED', ''),
    pr: { reviewDecision: 'APPROVED' },
  },
  reviewerRequestsChanges: {
    says: 'ada requests changes',
    adds: personReview('r-ada-changes', 'ada', 'CHANGES_REQUESTED', 'Please keep the old flag until the rollout is done.'),
    pr: { reviewDecision: 'CHANGES_REQUESTED' },
  },
  reviewerComments: {
    says: 'ada leaves a review comment',
    adds: personReview('r-ada-comment', 'ada', 'COMMENTED', 'Left two small notes on the retry helper.'),
  },
  authorPushes: {
    says: 'the author pushes a commit',
    adds: [{ commit: makeCommit({ oid: 'author-fix', headline: 'Reset backoff after success', author: 'alice', committedAt: CORPUS_AT }) }],
  },
  authorConvertsToDraft: {
    says: 'the author turns the PR back into a draft',
    adds: [timeline('tl-draft', 'converted_to_draft', 'alice')],
    pr: { isDraft: true },
  },
  authorRemovesRequest: {
    says: 'the author removes the review request for lyra',
    adds: [timeline('tl-rr-removed', 'review_request_removed', 'alice', 'lyra')],
  },
  personReopens: {
    says: 'ada reopens the PR she closed earlier',
    before: [{ timeline: makeTimelineItem({ id: 'tl-closed-earlier', kind: 'closed', actor: 'ada', subject: null, at: at(12) }) }],
    adds: [timeline('tl-reopened', 'reopened', 'ada')],
  },
  personMerges: {
    says: 'ada merges the PR',
    adds: [timeline('tl-ada-merged', 'merged', 'ada')],
    pr: { ...MERGED, mergedBy: 'ada' },
  },
} satisfies Record<string, CorpusEntry>;

export type CorpusEntryName = keyof typeof CORPUS;

// --- Scenarios --------------------------------------------------------------

export interface CorpusScenario {
  says: string;
  /** The PR before the corpus activity: everything on it is older than CORPUS_LAST_READ. */
  pr: Pr;
  /** Its notification thread, read at CORPUS_LAST_READ and unread again since. */
  thread: NotificationThread;
}

function scenario(says: string, pr: Pr): CorpusScenario {
  return { says, pr, thread: makeThreadFor(pr, { unread: true, lastReadAt: CORPUS_LAST_READ, updatedAt: CORPUS_AT }) };
}

const ownOpenPr = makePr({
  number: 4411,
  title: 'Move CI runners to a dedicated pool',
  author: 'viewer',
  reviewerUsers: ['lyra'],
  commits: [makeCommit({ oid: 'head', headline: 'Move runners', author: 'viewer', committedAt: at(2) })],
  timeline: [makeTimelineItem({ id: 'tl-own-rr', kind: 'review_requested', actor: 'viewer', subject: 'lyra', at: at(3) })],
  updatedAt: at(3),
});

const reviewingPr = makePr({
  number: 4420,
  title: 'Add retry backoff to the deploy client',
  author: 'alice',
  commits: [makeCommit({ oid: 'head', headline: 'Add backoff', author: 'alice', committedAt: at(2) })],
  timeline: [makeTimelineItem({ id: 'tl-rr-viewer', kind: 'review_requested', actor: 'alice', subject: 'viewer', at: at(3) })],
  reviews: [makeReview({ id: 'r-viewer-old', author: 'viewer', state: 'APPROVED', submittedAt: at(20), commitOid: 'head' })],
  reviewDecision: 'APPROVED',
  updatedAt: at(20),
});

const teamRoutedPr = makePr({
  number: 4430,
  title: 'Bump the ingestion worker memory limit',
  author: 'rowan',
  reviewerTeams: ['acme/approvers'],
  commits: [makeCommit({ oid: 'head', headline: 'Raise memory limit', author: 'rowan', committedAt: at(2) })],
  timeline: [makeTimelineItem({ id: 'tl-routed', kind: 'review_requested', actor: 'pr-assigner-resolver-posthog', subject: 'acme/approvers', at: at(3) })],
  updatedAt: at(3),
});

const mergedPr = makePr({
  number: 4440,
  title: 'Drop the legacy runner labels',
  author: 'alice',
  state: 'MERGED',
  commits: [makeCommit({ oid: 'head', headline: 'Drop labels', author: 'alice', committedAt: at(2) })],
  timeline: [
    makeTimelineItem({ id: 'tl-rr-merged', kind: 'review_requested', actor: 'alice', subject: 'viewer', at: at(3) }),
    makeTimelineItem({ id: 'tl-merged-before', kind: 'merged', actor: 'trunk-io[bot]', subject: null, at: at(22) }),
  ],
  reviews: [makeReview({ id: 'r-viewer-merged', author: 'viewer', state: 'APPROVED', submittedAt: at(20), commitOid: 'head' })],
  reviewDecision: 'APPROVED',
  mergedAt: at(22),
  mergedBy: 'trunk-io[bot]',
  updatedAt: at(22),
});

const dependabotPr = makePr({
  number: 4450,
  title: 'Bump vite from 5.4.1 to 5.4.8',
  author: 'dependabot[bot]',
  reviewerTeams: ['acme/team-platform'],
  commits: [makeCommit({ oid: 'head', headline: 'Bump vite', author: 'dependabot[bot]', committedAt: at(2) })],
  timeline: [makeTimelineItem({ id: 'tl-dependabot-rr', kind: 'review_requested', actor: 'dependabot[bot]', subject: 'acme/team-platform', at: at(3) })],
  updatedAt: at(3),
});

const agentPr = makePr({
  number: 4460,
  title: 'Fix flaky snapshot test in the runner suite',
  author: 'posthog[bot]',
  assignees: ['viewer'],
  isDraft: true,
  commits: [makeCommit({ oid: 'head', headline: 'Fix flaky snapshot', author: 'posthog[bot]', committedAt: at(2) })],
  updatedAt: at(2),
});

/** The PRs the corpus lands on, each read by the viewer at CORPUS_LAST_READ. */
export const CORPUS_SCENARIOS = {
  ownOpen: scenario("the viewer's own open PR, review requested from lyra", ownOpenPr),
  reviewing: scenario("alice's PR, which the viewer was asked to review and approved", reviewingPr),
  teamRouted: scenario("rowan's PR, routed to acme/approvers by pr-assigner-resolver-posthog", teamRoutedPr),
  merged: scenario("alice's PR, approved by the viewer and merged by trunk-io", mergedPr),
  dependabot: scenario("dependabot's PR, review requested from the viewer's team", dependabotPr),
  agentForViewer: scenario('a draft posthog[bot] opened and assigned to the viewer', agentPr),
} satisfies Record<string, CorpusScenario>;

export type CorpusScenarioName = keyof typeof CORPUS_SCENARIOS;

// --- Applying an entry ------------------------------------------------------

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((existing) => existing.id === item.id) ? list.map((existing) => (existing.id === item.id ? item : existing)) : [...list, item];
}

/** An inline comment also lives in its review thread; the thread is made on first use. */
function withThreadComment(pr: Pr, comment: Comment): Pr {
  if (comment.threadId === null) {
    return pr;
  }
  const thread = pr.threads.find((candidate) => candidate.id === comment.threadId) ?? { id: comment.threadId, path: comment.path ?? '', isResolved: false, comments: [] };
  const updated = { ...thread, comments: upsertById(thread.comments, comment) };
  return { ...pr, threads: upsertById(pr.threads, updated) };
}

function applyArtifact(pr: Pr, artifact: CorpusArtifact): Pr {
  if ('comment' in artifact) {
    return withThreadComment({ ...pr, comments: upsertById(pr.comments, artifact.comment) }, artifact.comment);
  }
  if ('review' in artifact) {
    return { ...pr, reviews: upsertById(pr.reviews, artifact.review) };
  }
  if ('timeline' in artifact) {
    return { ...pr, timeline: upsertById(pr.timeline, artifact.timeline) };
  }
  return { ...pr, commits: [...pr.commits, artifact.commit], headOid: artifact.commit.oid };
}

/** The PR with the entry's `before` artifacts: what was there when the viewer last read it. */
export function corpusPrBefore(base: Pr, entry: CorpusEntry): Pr {
  return (entry.before ?? []).reduce(applyArtifact, base);
}

/** The PR once the entry happened. */
export function corpusPrAfter(base: Pr, entry: CorpusEntry): Pr {
  const before = corpusPrBefore(base, entry);
  const after = entry.adds.reduce(applyArtifact, before);
  return { ...after, ...entry.pr, updatedAt: CORPUS_AT };
}

export interface CorpusEvents {
  pr: Pr;
  /** Every event on the PR, the ones from before the last read marked seen at it. */
  events: PrEvent[];
  /** The events the entry added, unseen. */
  added: PrEvent[];
}

/**
 * Derives the events of a scenario PR before and after the entry, the way a
 * sync would: what was there at the last read is seen, what the entry added
 * is new and unseen.
 */
export function corpusEvents(scenarioPr: Pr, entry: CorpusEntry, viewer: Viewer = CORPUS_VIEWER): CorpusEvents {
  const before = corpusPrBefore(scenarioPr, entry);
  const seenIds = new Set(deriveEvents(before, viewer, null).map((event) => event.id));
  const pr = corpusPrAfter(scenarioPr, entry);
  const events = deriveEvents(pr, viewer, null).map((event) =>
    seenIds.has(event.id) && event.at <= CORPUS_LAST_READ ? { ...event, seenAt: CORPUS_LAST_READ } : event,
  );
  return { pr, events, added: events.filter((event) => !seenIds.has(event.id)) };
}
