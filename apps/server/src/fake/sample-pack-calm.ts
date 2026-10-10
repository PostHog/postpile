// POSTPILE_FAKE_EXTRA=calm: a tiny sample where everything is read and
// dealt with, for the empty and quiet states (BOARD-32): three topics whose
// PRs all merged and were read (each shows the Archive-now box), and one
// topic holding only a snoozed tile. It replaces the default sample, so it
// cannot be combined with another pack: the server refuses to start then.
// PR numbers 2501 and up; names and text are invented.
import type { Snooze } from '@postpile/core';
import type { FakeExtra } from './fake-extras.ts';
import { pinged, SAMPLE_VIEWER, SampleClock, sampleEvents, sampleGlance, sampleKey, samplePr, sampleTile, sampleTopic } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';
import type { SampleMemory } from './sample-memory.ts';

export const CALM_TOPIC = {
  lintConfig: 'topic-calm-lint-config',
  runnerCleanup: 'topic-calm-runner-cleanup',
  docsCache: 'topic-calm-docs-cache',
  flagCleanup: 'topic-calm-flag-cleanup',
};

function buildTopics(clock: SampleClock) {
  return [
    sampleTopic(clock, {
      id: CALM_TOPIC.lintConfig, area: 'Dev env', name: 'Lint config',
      summary: 'Moved the lint config to the shared preset. Merged.', tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: CALM_TOPIC.runnerCleanup, area: 'CI', name: 'Runner cleanup',
      summary: 'rowan removed the unused runner labels. Both PRs merged.', tailoring: '', driver: 'rowan', userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: CALM_TOPIC.docsCache, area: 'Docs', name: 'Docs build cache',
      summary: 'tove caches the docs build. Merged.', tailoring: '', driver: 'tove', userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: CALM_TOPIC.flagCleanup, area: 'Dev env', name: 'Feature flag cleanup',
      summary: 'sol removes flags that are on everywhere. You put it away until tomorrow.', tailoring: '', driver: 'sol', userRole: 'watcher',
    }),
  ];
}

function buildPrs(clock: SampleClock) {
  return [
    samplePr(clock, {
      number: 2501, title: 'Use the shared lint preset', author: SAMPLE_VIEWER, state: 'MERGED',
      size: [12, 80, 3], openedHoursAgo: 80, mergedHoursAgo: 30, reviews: [['lyra', 'APPROVED', '', undefined, 32]],
    }),
    samplePr(clock, {
      number: 2502, title: 'Drop the unused runner labels', author: 'rowan', state: 'MERGED',
      size: [2, 30, 4], openedHoursAgo: 70, mergedHoursAgo: 26, reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 28]],
    }),
    samplePr(clock, {
      number: 2503, title: 'Remove the runner label docs', author: 'rowan', state: 'MERGED',
      size: [0, 12, 1], openedHoursAgo: 60, mergedHoursAgo: 25, reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 27]],
    }),
    samplePr(clock, {
      number: 2504, title: 'Cache the docs build between runs', author: 'tove', state: 'MERGED',
      size: [20, 4, 2], openedHoursAgo: 50, mergedHoursAgo: 20, reviews: [['nell', 'APPROVED', '', undefined, 22]],
    }),
    samplePr(clock, {
      number: 2505, title: 'Remove flags that are on everywhere', author: 'sol', state: 'OPEN',
      size: [10, 160, 14], openedHoursAgo: 12,
    }),
  ];
}

function buildEvents(clock: SampleClock) {
  return [
    ...sampleEvents(clock, 2501, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 32, rule: 'loud', seen: true },
      { kind: 'merged', actor: SAMPLE_VIEWER, text: 'merged it', hoursAgo: 30, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2502, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 70, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 28, rule: 'quiet', seen: true },
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 26, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2503, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 60, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 27, rule: 'quiet', seen: true },
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 25, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2504, [
      { kind: 'merged', actor: 'tove', text: 'merged it', hoursAgo: 20, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2505, [
      { kind: 'comment', actor: 'sol', text: 'commented: "every flag here has been on for a month"', hoursAgo: 11, rule: 'quiet', seen: true },
    ]),
  ];
}

function buildGlances(clock: SampleClock) {
  return [
    sampleGlance(clock, 2505, {
      verdict: 'LOOKS_SAFE', forYou: 'You follow flag cleanups; nothing asked of you.', does: 'Removes twelve flags that are on for everyone.',
      risk: 'Low.', othersSaid: 'No reviews yet.',
    }),
  ];
}

function buildTiles() {
  const single = (topicId: string, number: number, title: string, reason: Parameters<typeof pinged>[1]) =>
    sampleTile(topicId, 'single', `pr:${sampleKey(number)}`, title, [pinged(number, reason)]);
  return [
    single(CALM_TOPIC.lintConfig, 2501, 'Shared lint preset merged', 'author'),
    single(CALM_TOPIC.runnerCleanup, 2502, 'Unused runner labels dropped', 'review_requested'),
    single(CALM_TOPIC.runnerCleanup, 2503, 'Runner label docs removed', 'review_requested'),
    single(CALM_TOPIC.docsCache, 2504, 'Docs build cached', 'subscribed'),
    single(CALM_TOPIC.flagCleanup, 2505, 'sol removes flags that are on everywhere', 'subscribed'),
  ];
}

/** The open PR is snoozed until tomorrow morning. */
function buildSnoozes(clock: SampleClock): Snooze[] {
  return [{ prKey: sampleKey(2505), condition: { kind: 'until_time', until: clock.hoursAgo(-18) }, since: clock.hoursAgo(10) }];
}

/** The calm pack replaces the sample; any other pack next to it is a mistake worth stopping for. */
function refuseOtherPacks(extras: Set<FakeExtra>): void {
  if (extras.size > 1) {
    const others = [...extras].filter((extra) => extra !== 'calm').join(', ');
    throw new Error(`POSTPILE_FAKE_EXTRA=calm replaces the sample and cannot be combined with other packs (also asked for: ${others}).`);
  }
}

/** Replaces the default sample with the calm one. Viewer, teams and CODEOWNERS stay. */
export function replaceWithCalmSample(data: SampleData, clock: SampleClock, extras: Set<FakeExtra>): void {
  refuseOtherPacks(extras);
  const tiles = buildTiles();
  data.topics = buildTopics(clock);
  data.prs = buildPrs(clock);
  data.events = buildEvents(clock);
  data.glances = buildGlances(clock);
  data.tiles = tiles;
  data.sets = [];
  data.proposals = [];
  data.userStates = [];
  data.snoozes = buildSnoozes(clock);
  data.membership = new Map(tiles.flatMap((tile) => tile.members.map((member) => [member.prKey, tile.topicId] as const)));
}

/** No dossiers, facts or proposals: the default sample's are about topics the calm sample does not have. */
export function replaceWithCalmMemory(memory: SampleMemory): void {
  memory.dossiers.clear();
  memory.facts = [];
  memory.ruleProposals = [];
  memory.nextRuleProposals = [];
  memory.seen.clear();
  memory.feedback = [];
  memory.relations.clear();
}
