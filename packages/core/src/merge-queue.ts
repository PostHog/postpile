// Where a PR stands in the Trunk merge queue, from what trunk-io[bot] says on
// it (DESIGN.md "Merge queue"). Trunk keeps one status comment per PR (it
// starts with `<!-- Trunk Merge -->`) and edits it at every step; the
// snapshot holds its latest text. Some outcomes, stack ones mostly, come as
// separate comments. The newest status line wins. Text this file does not
// know reads as nothing: never guess a queue state. Rules only, no IO.
import { isTrunkBot } from './bots.ts';
import { prKey } from './keys.ts';
import type { Comment, IsoTime, Pr, PrKey } from './types.ts';

/**
 * submitted: waiting for branch protection (checks, approvals) before it
 * enters the queue. waiting: in the queue, tests not started (also a stack
 * layer queued as part of the stack). testing: tests run. failed: trunk
 * took it out of the queue (tests failed, waited too long, the stack changed).
 */
export type MergeQueueStep = 'submitted' | 'waiting' | 'testing' | 'failed';

export interface MergeQueueState {
  state: MergeQueueStep;
  /** When trunk said so: the status comment's last edit, else when it was posted. */
  since: IsoTime;
  /** failed: why, in a few words ("tests failed"). Null for the other steps. */
  reason: string | null;
  /** testing: the PR trunk tests on (a batch or the stack's top), null when it does not say. */
  testingOn: PrKey | null;
}

/** What one trunk comment says: a queue step, out of the queue (not submitted, merged, cancelled), or text nobody knows. */
type TrunkLine = { kind: 'step'; step: MergeQueueStep; reason: string | null; testingOn: number | null } | { kind: 'out' } | { kind: 'unknown' };

/** A status comment of trunk's and when it said it. */
interface StatusComment {
  at: IsoTime;
  line: TrunkLine;
}

const TEST_ANALYTICS_MARKER = '<!-- Trunk Test Analytics -->';

/**
 * Trunk comments that say nothing about the queue: its test report badge,
 * and replies to a `/trunk` command ("This PR is already queued ...", an
 * error about the command). They are skipped, so the status before them stands.
 */
const NOT_STATUS = [/^This PR is already queued/, /An error occurred while handling your Trunk command/];

function isStatusComment(comment: Comment): boolean {
  if (!isTrunkBot(comment.author) || comment.body.includes(TEST_ANALYTICS_MARKER)) {
    return false;
  }
  return !NOT_STATUS.some((pattern) => pattern.test(comment.body));
}

/**
 * The first line with text, HTML comments (trunk's markers) removed. Trunk
 * puts an en space after its emoji: every run of whitespace becomes one
 * plain space, and emoji variation selectors go.
 */
function firstLine(body: string): string {
  const visible = body.replace(/<!--[\s\S]*?-->/g, '').replaceAll('\uFE0F', '');
  const line = visible.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.replace(/\s+/g, ' ').trim();
}

function step(step: MergeQueueStep, reason: string | null = null, testingOn: number | null = null): TrunkLine {
  return { kind: 'step', step, reason, testingOn };
}

/** The reason trunk gives for cancelling a stacked merge, as the failed reason. A user cancelling it is no failure. */
function cancelled(reason: string): TrunkLine {
  if (reason === 'a user cancelled it') {
    return { kind: 'out' };
  }
  return step('failed', reason.replace(/^it /, ''));
}

/** The reason after "because" in a removal: the known ones short, others as trunk words them. */
function removedBecause(reason: string): string {
  if (reason.startsWith('it was waiting to become mergeable for too long')) {
    return 'waited too long to become mergeable';
  }
  if (reason.startsWith('the GitHub stack changed')) {
    return 'the stack changed';
  }
  if (reason.startsWith('there was a merge conflict')) {
    return 'merge conflict';
  }
  return reason.split(' (')[0]!.split('. ')[0]!.replace(/\.$/, '');
}

/** One trunk status line, as seen in the field (DESIGN.md "Merge queue" lists them). */
function trunkLine(body: string): TrunkLine {
  const line = firstLine(body);
  let match: RegExpMatchArray | null;
  if (/^Merging to `[^`]+` in this repository is managed by Trunk/.test(line)) {
    return { kind: 'out' };
  }
  if (line.startsWith("This PR's base branch doesn't have a Merge Queue configured")) {
    return { kind: 'out' };
  }
  if (/^✨ (Stack )?[Ss]ubmitted to Merge by /.test(line)) {
    return step('submitted');
  }
  if (line.startsWith('⏳ Waiting to start tests')) {
    return step('waiting');
  }
  if (/^This pull request is queued for merge as part of \[\d+\]/.test(line)) {
    return step('waiting');
  }
  if (line.startsWith('🧪 Running tests on this pull request')) {
    match = line.match(/testing on PR \[#?(\d+)\]/);
    return step('testing', null, match ? Number(match[1]) : null);
  }
  if (/^😎 .*\bmerged\b/i.test(line) || /^This pull request was merged into `[^`]+` as part of stacked PR/.test(line)) {
    return { kind: 'out' };
  }
  if ((match = line.match(/^🚫 This (?:pull request|stack) was removed from the merge queue because (.+)$/))) {
    return step('failed', removedBecause(match[1]!));
  }
  if ((match = line.match(/^❌ This (?:pull request|stack) could not start testing because (.+?)\./))) {
    return step('failed', removedBecause(match[1]!));
  }
  if (/^Stacked PR \[\d+\]\([^)]*\) failed testing in the merge queue/.test(line)) {
    return step('failed', 'tests failed');
  }
  if ((match = line.match(/^Stacked PR \[\d+\]\([^)]*\) was cancelled: (.+?)\.?$/))) {
    return cancelled(match[1]!);
  }
  if ((match = line.match(/^Stacked PR \[\d+\]\([^)]*\) was returned to waiting: (.+?)\./))) {
    return step('failed', match[1] === 'this pull request was pushed to' ? 'pushed to while queued' : match[1]!);
  }
  return { kind: 'unknown' };
}

/** Trunk's status comments, oldest first, each at its last edit (else when posted). */
function statusComments(pr: Pr): StatusComment[] {
  return pr.comments
    .filter(isStatusComment)
    .map((comment) => ({ at: comment.lastEditedAt ?? comment.createdAt, line: trunkLine(comment.body) }))
    .toSorted((a, b) => a.at.localeCompare(b.at));
}

function stateOf(status: StatusComment | undefined, pr: Pr): MergeQueueState | null {
  if (status === undefined || status.line.kind !== 'step') {
    return null;
  }
  const { line } = status;
  return {
    state: line.step,
    since: status.at,
    reason: line.reason,
    testingOn: line.testingOn === null ? null : prKey({ repo: pr.ref.repo, number: line.testingOn }),
  };
}

/**
 * The PR's place in the Trunk merge queue, from the newest trunk status
 * comment. Null for a PR that is not open, not submitted, merged, cancelled
 * by a user, or whose newest status trunk words in a way this file does not
 * know. A push after a failure keeps it failed until trunk says otherwise.
 */
export function mergeQueueState(pr: Pr): MergeQueueState | null {
  if (pr.state !== 'OPEN') {
    return null;
  }
  return stateOf(statusComments(pr).at(-1), pr);
}

/**
 * The trunk comment or edit at `at` took the queue state to failed (from
 * any other state or none), and the PR is still failed in the queue: the
 * failure the viewer has to act on. Null otherwise. The loudness table
 * reads it for trunk's events on the viewer's own PR.
 */
export function mergeQueueFailureAt(pr: Pr, at: IsoTime): MergeQueueState | null {
  const now = mergeQueueState(pr);
  if (now === null || now.state !== 'failed') {
    return null;
  }
  const statuses = statusComments(pr);
  const then = stateOf(statuses.filter((status) => status.at <= at).at(-1), pr);
  const before = stateOf(statuses.filter((status) => status.at < at).at(-1), pr);
  if (then === null || then.since !== at || then.state !== 'failed' || before?.state === 'failed') {
    return null;
  }
  return then;
}
