import { describe, expect, it } from 'vitest';
import { isTrunkBot } from './bots.ts';
import { memoryRole, type MemoryRole } from './event-roles.ts';
import { at, makeComment, makePr } from './fixtures.ts';
import { mergeQueueFailureAt, mergeQueueState, type MergeQueueStep } from './merge-queue.ts';
import { CORPUS, CORPUS_SCENARIOS, corpusEvents, type CorpusEntryName, type CorpusScenarioName } from './testing/event-corpus.ts';
import type { Comment, Loudness } from './types.ts';

// Trunk's status lines as seen in the field, with invented names and numbers.
// Trunk puts an en space (U+2002) after its emoji.
const OFFER = [
  '<!-- Trunk Merge -->',
  'Merging to `main` in this repository is managed by Trunk.',
  '',
  '<!-- Start PR Submit Checkbox -->',
  '- [ ] <!-- End PR Submit Checkbox -->To merge this pull request, check the box to the left or comment `/trunk merge` below.',
].join('\n');
const SUBMITTED = '<!-- Trunk Merge -->\n✨\u2002Submitted to Merge by Alice Example (@alice). It will be added to the merge queue once all branch protection rules pass. See more details [here](https://trunk.example/q/1).';
const STACK_SUBMITTED = '<!-- Trunk Merge -->\n✨\u2002Stack submitted to Merge by Bob Example (a GitHub user). It will be added to the merge queue once all branch protection rules pass. See more details [here](https://trunk.example/q/2).';
const WAITING = '<!-- Trunk Merge -->\n⏳\u2002Waiting to start tests on this pull request - [details](https://trunk.example/q/3)';
const TESTING = '<!-- Trunk Merge -->\n🧪\u2002Running tests on this pull request (testing on PR [#1205](https://github.com/acme/app/pull/1205)) - [details](https://trunk.example/q/4).';
const STACK_QUEUED = 'This pull request is queued for merge as part of [1203](https://github.com/acme/app/pull/1203), which will merge [1201](https://github.com/acme/app/pull/1201), [1203](https://github.com/acme/app/pull/1203).';
const MERGED_LINES = [
  '😎\u2002Merged successfully - [details](https://trunk.example/q/5).',
  '😎\u2002Stack merged successfully - [details](https://trunk.example/q/6).',
  '<!-- Trunk Merge -->\n😎\u2002This pull request was merged.',
  '😎\u2002Merged directly without going through the merge queue, as the queue was empty and the PR was up to date with the target branch - [details](https://trunk.example/q/7).',
  'This pull request was merged into `main` as part of stacked PR [1203](https://github.com/acme/app/pull/1203).',
];
const REMOVED_TOO_LONG = `🚫\u2002This pull request was removed from the merge queue because it was waiting to become mergeable for too long (for example: missing required approvals or checks, or a merge conflict). Submit it again once it's ready to merge. See more details [here](https://trunk.example/q/8).\n${OFFER.split('\n').slice(3).join('\n')}`;
const STACK_CHANGED = '🚫\u2002This stack was removed from the merge queue because the GitHub stack changed. Please re-submit it in order to merge. See more details [here](https://trunk.example/q/9).';
const CONFLICT = '❌\u2002This stack could not start testing because there was a merge conflict. See more details [here](https://trunk.example/q/10).';
const STACK_FAILED = 'Stacked PR [1203](https://github.com/acme/app/pull/1203) failed testing in the merge queue. Please investigate the failure and re-submit the stack.';
const CANCELLED_TOO_LONG = 'Stacked PR [1203](https://github.com/acme/app/pull/1203) was cancelled: it waited too long to become mergeable.';
const CANCELLED_BY_USER = 'Stacked PR [1203](https://github.com/acme/app/pull/1203) was cancelled: a user cancelled it.';
const CANCELLED_STACK_CHANGED = 'Stacked PR [1203](https://github.com/acme/app/pull/1203) was cancelled: the stack changed after it was queued.';
const RETURNED = "Stacked PR [1203](https://github.com/acme/app/pull/1203) was returned to waiting: this pull request was pushed to. Rebase the stack onto this pull request's new head and the stacked merge re-enters the queue on its own.";
const TEST_ANALYTICS = '<!-- Trunk Test Analytics -->\n<sub>\n\n[![Static Badge](https://img.example/badge)](https://trunk.example/t)\n</sub>';

function trunk(body: string, minutes: number, overrides: Partial<Comment> = {}): Comment {
  return makeComment({ id: `t${minutes}`, author: 'trunk-io[bot]', body, createdAt: at(minutes), ...overrides });
}

function stateOf(...comments: Comment[]) {
  return mergeQueueState(makePr({ comments }));
}

describe('mergeQueueState', () => {
  it.each([
    ['submitted', SUBMITTED],
    ['submitted', STACK_SUBMITTED],
    ['waiting', WAITING],
    ['waiting', STACK_QUEUED],
    ['testing', TESTING],
  ])('reads %s from trunk status line', (state, body) => {
    expect(stateOf(trunk(body, 5))).toMatchObject({ state, since: at(5), reason: null });
  });

  it('names the PR trunk tests on', () => {
    expect(stateOf(trunk(TESTING, 5))?.testingOn).toBe('acme/app#1205');
    expect(stateOf(trunk(WAITING, 5))?.testingOn).toBeNull();
  });

  it.each([
    ['waited too long to become mergeable', REMOVED_TOO_LONG],
    ['the stack changed', STACK_CHANGED],
    ['merge conflict', CONFLICT],
    ['tests failed', STACK_FAILED],
    ['waited too long to become mergeable', CANCELLED_TOO_LONG],
    ['the stack changed after it was queued', CANCELLED_STACK_CHANGED],
    ['pushed to while queued', RETURNED],
  ])('reads failed (%s)', (reason, body) => {
    expect(stateOf(trunk(body, 5))).toEqual({ state: 'failed', since: at(5), reason, testingOn: null });
  });

  it('is null when not submitted, merged, or cancelled by a user', () => {
    expect(stateOf(trunk(OFFER, 5))).toBeNull();
    for (const body of MERGED_LINES) {
      expect(stateOf(trunk(TESTING, 5), trunk(body, 6))).toBeNull();
    }
    expect(stateOf(trunk(STACK_QUEUED, 5), trunk(CANCELLED_BY_USER, 6))).toBeNull();
  });

  it('is null for text it does not know, never a guess', () => {
    expect(stateOf(trunk(TESTING, 5), trunk('🛸\u2002Something new happened to this pull request.', 6))).toBeNull();
  });

  it('is null for merged and closed PRs, whatever the comment says', () => {
    expect(mergeQueueState(makePr({ state: 'MERGED', comments: [trunk(TESTING, 5)] }))).toBeNull();
    expect(mergeQueueState(makePr({ state: 'CLOSED', comments: [trunk(STACK_FAILED, 5)] }))).toBeNull();
  });

  it('follows the sticky comment by its last edit, and a newer separate comment over it', () => {
    const sticky = trunk(TESTING, 5, { lastEditedAt: at(30) });
    expect(stateOf(sticky)).toMatchObject({ state: 'testing', since: at(30) });
    // A stack failure posted at 20 is older than the sticky's edit at 30.
    expect(stateOf(sticky, trunk(STACK_FAILED, 20))?.state).toBe('testing');
    expect(stateOf(sticky, trunk(STACK_FAILED, 40))).toMatchObject({ state: 'failed', since: at(40) });
  });

  it('walks a stack through the queue to its failure', () => {
    const sticky = trunk(STACK_SUBMITTED, 1, { lastEditedAt: at(2) });
    expect(stateOf(sticky, trunk(STACK_QUEUED, 10))?.state).toBe('waiting');
    expect(stateOf(sticky, trunk(STACK_QUEUED, 10), trunk(STACK_FAILED, 20))).toMatchObject({ state: 'failed', reason: 'tests failed' });
  });

  it('skips the test report badge, command replies and other people', () => {
    const replies = [
      trunk(TEST_ANALYTICS, 10),
      trunk('This PR is already queued as a stacked merge. Cancel it first to re-submit.', 11),
      trunk('>invalid\n\nAn error occurred while handling your Trunk command: `Unexpected argument`', 12),
      makeComment({ id: 'h1', author: 'alice', body: '😎 Merged successfully', createdAt: at(13) }),
    ];
    expect(stateOf(trunk(TESTING, 5), ...replies)?.state).toBe('testing');
  });

  it('keeps a failure after a push, until trunk says otherwise', () => {
    const pr = makePr({ comments: [trunk(STACK_FAILED, 5)], commits: [{ oid: 'c2', headline: 'fix', author: 'alice', committedAt: at(9) }] });
    expect(mergeQueueState(pr)?.state).toBe('failed');
  });
});

describe('mergeQueueFailureAt', () => {
  it('is the comment or edit that took the PR out of the queue', () => {
    const pr = makePr({ comments: [trunk(TESTING, 5, { lastEditedAt: at(8) }), trunk(STACK_FAILED, 20)] });
    expect(mergeQueueFailureAt(pr, at(20))).toMatchObject({ state: 'failed', reason: 'tests failed' });
    expect(mergeQueueFailureAt(pr, at(8))).toBeNull();
  });

  it('is only the first of two failure lines in a row', () => {
    const pr = makePr({ comments: [trunk(STACK_FAILED, 20), trunk(CANCELLED_TOO_LONG, 25)] });
    expect(mergeQueueFailureAt(pr, at(20))).not.toBeNull();
    expect(mergeQueueFailureAt(pr, at(25))).toBeNull();
  });

  it('is null on a draft, even right after the failure', () => {
    const pr = makePr({ isDraft: true, comments: [trunk(STACK_FAILED, 20)] });
    expect(mergeQueueFailureAt(pr, at(20))).toBeNull();
    expect(mergeQueueState(pr)).toBeNull();
  });

  it('is gone once the PR is back in the queue or merged', () => {
    const resubmitted = makePr({ comments: [trunk(STACK_FAILED, 20), trunk(SUBMITTED, 30)] });
    expect(mergeQueueFailureAt(resubmitted, at(20))).toBeNull();
    const merged = makePr({ state: 'MERGED', comments: [trunk(STACK_FAILED, 20)] });
    expect(mergeQueueFailureAt(merged, at(20))).toBeNull();
  });
});

describe('the Trunk corpus entries', () => {
  // Each Trunk comment of the event corpus: the queue state it leaves, and
  // what its event is. Only a failure on the viewer's own PR is loud, and loud
  // is a memory trigger; every other queue status stays noise.
  const rows: [CorpusEntryName, CorpusScenarioName, MergeQueueStep | null, Loudness, MemoryRole][] = [
    ['trunkSticky', 'ownOpen', null, 'quiet', 'noise'],
    ['trunkSubmitted', 'ownOpen', 'submitted', 'quiet', 'noise'],
    ['trunkWaiting', 'ownOpen', 'waiting', 'quiet', 'noise'],
    ['trunkTesting', 'ownOpen', 'testing', 'quiet', 'noise'],
    ['trunkRemoved', 'ownOpen', 'failed', 'loud', 'trigger'],
    ['trunkStackFailed', 'ownOpen', 'failed', 'loud', 'trigger'],
    ['trunkRemoved', 'reviewing', 'failed', 'quiet', 'noise'],
    ['trunkStackCancelled', 'ownOpen', null, 'quiet', 'noise'],
    ['trunkMergedComment', 'merged', null, 'quiet', 'noise'],
    ['trunkTestBadge', 'reviewing', null, 'quiet', 'noise'],
  ];

  it.each(rows)('%s on %s: queue %s, %s, %s', (entry, scenario, state, loudness, role) => {
    const corpus = corpusEvents(CORPUS_SCENARIOS[scenario].pr, CORPUS[entry]);
    expect(mergeQueueState(corpus.pr)?.state ?? null).toBe(state);
    const event = corpus.added.find((candidate) => isTrunkBot(candidate.actor));
    expect(event).toBeDefined();
    expect(event!.ruleLoudness).toBe(loudness);
    expect(memoryRole(event!)).toBe(role);
  });
});
