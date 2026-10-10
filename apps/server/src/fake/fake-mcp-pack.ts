import type { FileEdits, LineRange, PrEdits } from '@postpile/core';
import { pinged, SAMPLE_VIEWER, sampleEvents, sampleGlance, sampleKey, samplePr, sampleRepo, sampleTile, type SampleClock } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

const DEPOT_TOPIC = 'topic-depot';
const WORKFLOW = '.github/workflows/ci-backend.yml';

/** Base-side lines `start` to `end`, both included. */
function lines(start: number, end: number): LineRange {
  return { start, end };
}

/** One PR's changed lines per file, on the PR's own base branch, like the sync's diff read. */
function edits(data: SampleData, number: number, files: FileEdits[], capped = false): PrEdits {
  const key = sampleKey(number);
  const pr = data.prs.find((candidate) => candidate.key === key);
  if (pr === undefined) {
    throw new Error(`mcp pack: no sample PR ${key}`);
  }
  return { prKey: key, repo: sampleRepo(number), baseRef: pr.baseRef, files, capped };
}

/** sol's PR on the same workflow lines as #1902: the overlap pr_context and whats_on_me report. */
function addSolsWarmUpPr(data: SampleData, clock: SampleClock): void {
  data.prs.push(
    samplePr(clock, {
      number: 2301, title: 'Retry the Depot cache warm-up with backoff', author: 'sol', state: 'OPEN',
      size: [14, 6, 1], openedHoursAgo: 2,
      baseRef: 'rowan/depot-2', headRef: 'sol/warm-up-retry', reviewerUsers: [SAMPLE_VIEWER],
      body: 'The warm-up job fails on the first cold run. Retries it twice with backoff.',
      files: [[WORKFLOW, 14, 6]],
    }),
  );
  data.events.push(
    ...sampleEvents(clock, 2301, [{ kind: 'review_requested', actor: 'sol', text: 'requested your review', hoursAgo: 2, rule: 'loud' }]),
  );
  data.glances.push(
    sampleGlance(clock, 2301, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes the warm-up job that #1902 adds, in the same lines.',
      does: 'Retries the Depot cache warm-up twice with backoff.',
      risk: 'Whichever of #1902 and this merges second can drop the other one’s warm-up lines.',
      othersSaid: 'None yet.',
    }),
  );
  data.tiles.push(sampleTile(DEPOT_TOPIC, 'single', `pr:${sampleKey(2301)}`, 'sol retries the cache warm-up', [pinged(2301, 'review_requested')]));
  data.membership.set(sampleKey(2301), DEPOT_TOPIC);
}

/**
 * POSTPILE_FAKE_EXTRA=mcp: diff line ranges, so FakeEngine.prOverlaps() has
 * something to report (DESIGN.md "Overlapping edits"):
 * - #1902 and sol's new #2301 change the same lines of ci-backend.yml;
 * - #1978 and #1982 change ci-frontend.yml lines 5-6 and 13-14 (nearby);
 * - #1904 and #1921 change pnpm-lock.yaml lines 100-104 and 112-115: a lockfile, so not reported;
 * - #1911 sits on #1902 and #1907 on #1904: stack mates, never reported;
 * - #1934's diff is capped.
 */
export function addMcpPack(data: SampleData, clock: SampleClock): void {
  addSolsWarmUpPr(data, clock);
  data.prEdits.push(
    edits(data, 1902, [{ path: WORKFLOW, ranges: [lines(20, 48)] }]),
    edits(data, 2301, [{ path: WORKFLOW, ranges: [lines(30, 42)] }]),
    edits(data, 1911, [{ path: WORKFLOW, ranges: [lines(25, 40)] }]),
    edits(data, 1978, [{ path: '.github/workflows/ci-frontend.yml', ranges: [lines(5, 6)] }]),
    edits(data, 1982, [{ path: '.github/workflows/ci-frontend.yml', ranges: [lines(13, 14)] }]),
    edits(data, 1904, [
      { path: 'pnpm-lock.yaml', ranges: [lines(100, 104)] },
      { path: 'turbo.json', ranges: [lines(12, 16)] },
    ]),
    edits(data, 1921, [{ path: 'pnpm-lock.yaml', ranges: [lines(112, 115)] }]),
    edits(data, 1907, [{ path: 'turbo.json', ranges: [lines(10, 14)] }]),
    // A new file: an insertion before line 1. GitHub left the other files out.
    edits(data, 1934, [{ path: 'terraform/ingestion-runners/main.tf', ranges: [lines(1, 0)] }], true),
  );
}
