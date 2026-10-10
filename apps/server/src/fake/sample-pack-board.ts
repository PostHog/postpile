// POSTPILE_FAKE_EXTRA=board: board shapes the default sample never shows
// (an approved own PR alone in its topic, a whole "You drive" trio, a
// teammate's draft asking you, a thanks that asks nothing, a merge the
// glance calls Not yours, a closed PR next to an open one, a retired
// standing topic, a long reviewer list, approvals right after a comment).
// PR numbers 2001 and up; names and text are invented.
import type { PrEvent } from '@postpile/core';
import { approvedState, type SamplePack, type SamplePackMemory } from './sample-pack-common.ts';
import { found, pinged, SAMPLE_VIEWER, SampleClock, sampleEvents, sampleGlance, sampleKey, samplePr, sampleTile, sampleTopic } from './sample-builders.ts';

/** Topic ids, exported so a scripted step (WP1) can find them. */
export const BOARD_TOPIC = {
  releaseNotes: 'topic-release-notes-tooling',
  locale: 'topic-locale-files',
  searchRelevance: 'topic-search-relevance',
  docsLint: 'topic-docs-lint',
  devboxPrebuilds: 'topic-devbox-prebuilds',
  testTimeouts: 'topic-test-timeouts',
  mergedAway: 'topic-merged-while-away',
  logFormat: 'topic-log-format',
  releaseTrain: 'topic-release-train',
  prTemplate: 'topic-pr-template-checks',
  cacheMetrics: 'topic-build-cache-metrics',
};

function buildTopics(clock: SampleClock) {
  return [
    sampleTopic(clock, {
      id: BOARD_TOPIC.releaseNotes, area: 'Release', name: 'Release notes tooling',
      summary: 'A script that drafts release notes from merged PR titles. The one PR is approved.',
      tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.locale, area: 'Frontend', name: 'Locale files',
      summary: 'Moved the locale files next to the components. Merged, nothing left.',
      tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.searchRelevance, area: 'Search', name: 'Search relevance',
      summary: 'Boosts exact title matches in the docs search. lyra merged it for you.',
      tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.docsLint, area: 'Docs', name: 'Docs lint',
      summary: 'Markdown lint for the docs folder. Two rules merged, the link checker is a draft.',
      tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.devboxPrebuilds, area: 'Dev env', name: 'Devbox prebuilds',
      summary: 'sol prebuilds devbox images nightly. The first PR is still a draft.',
      tailoring: '', driver: 'sol', userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.testTimeouts, area: 'CI', name: 'Test timeouts',
      summary: 'nell and lyra tune per-suite test timeouts.',
      tailoring: '', driver: 'nell', userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.mergedAway, area: 'CI', name: 'Merged while away',
      summary: 'nell merged a lint job change your team was asked to review.',
      tailoring: '', driver: 'nell', userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.logFormat, area: 'Observability', name: 'Log format',
      summary: 'bram moves the worker logs to JSON. The first attempt was closed.',
      tailoring: '', driver: 'bram', userRole: 'reviewer',
    }),
    // Standing and retired 5 days ago: in the Archive. A new PR assigned to it brings it back (WP1 `assign-archived`).
    {
      ...sampleTopic(clock, {
        id: BOARD_TOPIC.releaseTrain, area: 'Release', name: 'Release train',
        summary: 'The weekly release branch cut. Each week one PR bumps the version.',
        tailoring: '', driver: null, userRole: 'watcher', kind: 'standing',
      }),
      status: 'retired' as const,
      retiredAt: clock.hoursAgo(120),
      updatedAt: clock.hoursAgo(120),
    },
    sampleTopic(clock, {
      id: BOARD_TOPIC.prTemplate, area: 'Dev env', name: 'PR template checks',
      summary: 'A CI check that the PR template sections are filled in. Waiting on four reviewers.',
      tailoring: '', driver: SAMPLE_VIEWER, userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: BOARD_TOPIC.cacheMetrics, area: 'CI', name: 'Build cache metrics',
      summary: 'sol reports cache hit rates per job. You approved both PRs.',
      tailoring: '', driver: 'sol', userRole: 'reviewer',
    }),
  ];
}

function buildPrs(clock: SampleClock) {
  return [
    // BOARD-07 / BOARD-22 C: own PR, approved by two people, nothing else open in the topic, read.
    samplePr(clock, {
      number: 2001, title: 'Draft release notes from merged PR titles', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [120, 4, 3], openedHoursAgo: 30,
      reviews: [['lyra', 'APPROVED', '', undefined, 6], ['nell', 'APPROVED', '', undefined, 5]],
    }),
    // BOARD-22 B: own merged PR, read, nothing waiting.
    samplePr(clock, {
      number: 2002, title: 'Move locale files next to their components', author: SAMPLE_VIEWER, state: 'MERGED',
      size: [40, 40, 22], openedHoursAgo: 60, mergedHoursAgo: 30, reviews: [['lyra', 'APPROVED', '', undefined, 32]],
    }),
    // BOARD-22 A: own PR lyra merged for you; the merge is unread.
    {
      ...samplePr(clock, {
        number: 2003, title: 'Boost exact title matches in docs search', author: SAMPLE_VIEWER, state: 'MERGED',
        size: [28, 6, 2], openedHoursAgo: 20, mergedHoursAgo: 1.5, reviews: [['lyra', 'APPROVED', '', undefined, 2]],
      }),
      mergedBy: 'lyra',
    },
    // BOARD-33: own open draft and two merged PRs, all read.
    samplePr(clock, {
      number: 2004, title: 'Check docs links in CI', author: SAMPLE_VIEWER, state: 'OPEN', draft: true,
      size: [64, 0, 2], openedHoursAgo: 26,
      commits: [{ oid: 'sha2004', headline: 'Check docs links in CI', hoursAgo: 26 }],
    }),
    samplePr(clock, {
      number: 2005, title: 'Lint heading levels in docs', author: SAMPLE_VIEWER, state: 'MERGED',
      size: [18, 2, 2], openedHoursAgo: 90, mergedHoursAgo: 70, reviews: [['nell', 'APPROVED', '', undefined, 72]],
    }),
    samplePr(clock, {
      number: 2006, title: 'Lint trailing spaces in docs', author: SAMPLE_VIEWER, state: 'MERGED',
      size: [6, 1, 1], openedHoursAgo: 80, mergedHoursAgo: 66, reviews: [['nell', 'APPROVED', '', undefined, 68]],
    }),
    // BOARD-09: a teammate's draft that requests your review, unread. WP1 `ready-for-review` marks it ready.
    samplePr(clock, {
      number: 2010, title: 'Prebuild devbox images nightly', author: 'sol', state: 'OPEN', draft: true,
      size: [150, 10, 5], openedHoursAgo: 3, reviewerUsers: [SAMPLE_VIEWER],
      body: 'Draft: the schedule and the image cache are still open.',
    }),
    // BOARD-05 B: you commented, nell answered "thanks, that's fine". Asks nothing.
    samplePr(clock, {
      number: 2012, title: 'Raise the frontend unit test timeout to 10s', author: 'nell', state: 'OPEN',
      size: [2, 2, 1], openedHoursAgo: 8,
      comments: [
        { id: 'issuecomment-2012-1', author: SAMPLE_VIEWER, body: 'Is 10s enough for the chart snapshot suite?', hoursAgo: 4 },
        { id: 'issuecomment-2012-2', author: 'nell', body: '@you thanks, that is fine. The chart suite runs in 6s now.', hoursAgo: 1 },
      ],
    }),
    // BOARD-05 A, for contrast: lyra asks you a direct question.
    samplePr(clock, {
      number: 2013, title: 'Fail the e2e job after 25 minutes', author: 'lyra', state: 'OPEN',
      size: [3, 1, 1], openedHoursAgo: 6,
      comments: [{ id: 'issuecomment-2013-1', author: 'lyra', body: '@you should the e2e limit be 25 or 30 minutes?', hoursAgo: 0.7 }],
    }),
    // BOARD-19: merged while your team was asked, never reviewed by you; the glance says Not yours.
    samplePr(clock, {
      number: 2014, title: 'Run the YAML lint job on changed files only', author: 'nell', state: 'MERGED',
      size: [14, 9, 1], openedHoursAgo: 40, mergedHoursAgo: 10,
      reviewerTeams: ['acme/team-platform'], reviews: [['rowan', 'APPROVED', '', undefined, 12]],
    }),
    // BOARD-21: closed without merging (it asked you for a review), and its open sibling.
    samplePr(clock, {
      number: 2015, title: 'Log worker jobs as JSON', author: 'bram', state: 'CLOSED',
      size: [90, 60, 7], openedHoursAgo: 50, reviewerUsers: [SAMPLE_VIEWER],
      comments: [{ id: 'issuecomment-2015-1', author: 'bram', body: 'Closing in favour of #2016, which keeps the old format behind a flag.', hoursAgo: 2 }],
    }),
    samplePr(clock, {
      number: 2016, title: 'Log worker jobs as JSON behind a flag', author: 'bram', state: 'OPEN',
      size: [110, 20, 8], openedHoursAgo: 2,
    }),
    // BOARD-35: the retired standing topic's last PR.
    samplePr(clock, {
      number: 2017, title: 'Cut release 2026.40', author: 'rowan', state: 'MERGED',
      size: [4, 4, 2], openedHoursAgo: 200, mergedHoursAgo: 170, reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 172]],
    }),
    // BOARD-08: own PR waiting on three people and a team ("and N more").
    samplePr(clock, {
      number: 2019, title: 'Check that PR template sections are filled in', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [52, 3, 3], openedHoursAgo: 20,
      reviewerUsers: ['lyra', 'nell', 'sol'], reviewerTeams: ['acme/docs'],
    }),
    // BOARD-17: you approved seconds after rowan's comment. On #2020 without reading it first, on #2021 after reading.
    samplePr(clock, {
      number: 2020, title: 'Report Turbo cache hit rate per job', author: 'sol', state: 'OPEN',
      size: [70, 5, 3], openedHoursAgo: 10, reviewerUsers: [],
      comments: [{ id: 'issuecomment-2020-1', author: 'rowan', body: 'The hit rate drops to 0 on the first run after a lockfile change; worth a note in the report?', hoursAgo: 2.002 }],
      reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 2]],
    }),
    samplePr(clock, {
      number: 2021, title: 'Send cache hit rates to the CI dashboard', author: 'sol', state: 'OPEN',
      size: [30, 2, 2], openedHoursAgo: 9, reviewerUsers: [],
      comments: [{ id: 'issuecomment-2021-1', author: 'rowan', body: 'Dashboard panel looks good on staging.', hoursAgo: 3.002 }],
      reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 3]],
    }),
  ];
}

/** The events agent lowered this ask to quiet: it asks nothing (DESIGN.md "Whose turn", rule 2). */
function loweredToQuiet(event: PrEvent, reason: string): PrEvent {
  return { ...event, override: { loudness: 'quiet', reason, by: 'agent' } };
}

function buildEvents(clock: SampleClock): PrEvent[] {
  const [thanks] = sampleEvents(clock, 2012, [
    { kind: 'reply_to_user', actor: 'nell', text: 'replied to you: "thanks, that is fine"', hoursAgo: 1, rule: 'loud', sourceId: 'issuecomment-2012-2' },
  ]);
  return [
    ...sampleEvents(clock, 2001, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 6, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: 'nell', text: 'approved', hoursAgo: 5, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 2002, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 32, rule: 'loud', seen: true },
      { kind: 'merged', actor: SAMPLE_VIEWER, text: 'merged it', hoursAgo: 30, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2003, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 2, rule: 'loud', seen: true },
      { kind: 'merged', actor: 'lyra', text: 'merged it', hoursAgo: 1.5, rule: 'quiet' },
    ]),
    // Your own push is your last touch: nothing came after it, so the draft is dealt with.
    ...sampleEvents(clock, 2004, [
      { kind: 'commits_pushed', actor: SAMPLE_VIEWER, text: 'pushed: Check docs links in CI', hoursAgo: 26, rule: 'quiet', sourceId: 'sha2004', seen: true },
    ]),
    ...sampleEvents(clock, 2005, [
      { kind: 'merged', actor: SAMPLE_VIEWER, text: 'merged it', hoursAgo: 70, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2006, [
      { kind: 'merged', actor: SAMPLE_VIEWER, text: 'merged it', hoursAgo: 66, rule: 'quiet', seen: true },
    ]),
    // A review request naming you on a draft is quiet by the rules (DESIGN.md "Drafts").
    ...sampleEvents(clock, 2010, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from you', hoursAgo: 3, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 2012, [
      { kind: 'comment', actor: SAMPLE_VIEWER, text: 'commented: "Is 10s enough for the chart snapshot suite?"', hoursAgo: 4, rule: 'quiet', sourceId: 'issuecomment-2012-1', seen: true },
    ]),
    loweredToQuiet(thanks!, 'Says thanks and answers your question; asks nothing.'),
    ...sampleEvents(clock, 2013, [
      { kind: 'question_to_user', actor: 'lyra', text: 'asked you: "should the e2e limit be 25 or 30 minutes?"', hoursAgo: 0.7, rule: 'loud', sourceId: 'issuecomment-2013-1' },
    ]),
    ...sampleEvents(clock, 2014, [
      { kind: 'review_requested', actor: 'nell', text: 'requested @team-platform', hoursAgo: 40, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: 'rowan', text: 'approved', hoursAgo: 12, rule: 'quiet', seen: true },
      { kind: 'merged_without_review', actor: 'nell', text: 'merged it without your review', hoursAgo: 10, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 2015, [
      { kind: 'review_requested', actor: 'bram', text: 'requested a review from you', hoursAgo: 50, rule: 'loud', seen: true },
      { kind: 'comment', actor: 'bram', text: 'commented: "Closing in favour of #2016"', hoursAgo: 2, rule: 'quiet', sourceId: 'issuecomment-2015-1' },
      { kind: 'closed', actor: 'bram', text: 'closed it', hoursAgo: 2, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 2016, [
      { kind: 'commits_pushed', actor: 'bram', text: 'opened the PR', hoursAgo: 2, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2017, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 200, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 172, rule: 'quiet', seen: true },
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 170, rule: 'quiet', seen: true },
    ]),
    // Unread: rowan's comment came 7 seconds before your approval, with no read in between.
    ...sampleEvents(clock, 2020, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from you', hoursAgo: 10, rule: 'loud', seen: true },
      { kind: 'comment', actor: 'rowan', text: 'commented: "worth a note in the report?"', hoursAgo: 2.002, rule: 'loud', sourceId: 'issuecomment-2020-1' },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 2, rule: 'quiet', sourceId: 'review-2020-0', seen: true },
    ]),
    // Read: you opened the comment, then approved.
    ...sampleEvents(clock, 2021, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from you', hoursAgo: 9, rule: 'loud', seen: true },
      { kind: 'comment', actor: 'rowan', text: 'commented: "Dashboard panel looks good on staging."', hoursAgo: 3.002, rule: 'loud', sourceId: 'issuecomment-2021-1', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 3, rule: 'quiet', sourceId: 'review-2021-0', seen: true },
    ]),
  ];
}

function buildGlances(clock: SampleClock) {
  return [
    sampleGlance(clock, 2001, {
      verdict: 'LOOKS_SAFE', forYou: 'Your PR; lyra and nell approved.', does: 'Adds a script that drafts release notes from merged PR titles.',
      risk: 'Low. A new script, nothing runs it in CI yet.', othersSaid: 'Two approvals, no comments.',
    }),
    sampleGlance(clock, 2010, {
      verdict: 'LOOK_CLOSER', forYou: 'sol asks you to review a draft that changes how devbox images are built.', does: 'Builds devbox images nightly and caches them.',
      risk: 'Medium once ready: a broken prebuild leaves everyone on an old image.', othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 2012, {
      verdict: 'LOOKS_SAFE', forYou: 'nell answered your question; nothing asked of you.', does: 'Raises the frontend unit test timeout from 5s to 10s.',
      risk: 'Low.', othersSaid: 'You asked about the chart suite; nell says it runs in 6s.',
    }),
    sampleGlance(clock, 2013, {
      verdict: 'LOOKS_SAFE', forYou: 'lyra asks you which limit to use.', does: 'Stops the e2e job after 25 minutes.',
      risk: 'Low. A slow run fails instead of hanging.', othersSaid: 'lyra asked you directly.',
    }),
    sampleGlance(clock, 2014, {
      verdict: 'NOT_YOURS', forYou: 'Only the lint job of the docs team changed; nothing platform runs.', does: 'Lints only the YAML files a PR changes.',
      risk: 'Low.', othersSaid: 'rowan approved.',
    }),
    sampleGlance(clock, 2015, {
      verdict: 'LOOKS_SAFE', forYou: 'Closed; #2016 replaces it.', does: 'Switched the worker logs to JSON in one go.',
      risk: 'None now.', othersSaid: 'bram closed it in favour of #2016.',
    }),
    sampleGlance(clock, 2016, {
      verdict: 'LOOKS_SAFE', forYou: 'Replaces #2015, which asked for your review.', does: 'Switches the worker logs to JSON behind a flag.',
      risk: 'Low. Off by default.', othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 2019, {
      verdict: 'LOOKS_SAFE', forYou: 'Your PR; four reviews are pending.', does: 'Fails CI when a PR leaves template sections empty.',
      risk: 'Low. A new check.', othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 2020, {
      verdict: 'LOOKS_SAFE', forYou: 'You approved; rowan commented just before.', does: 'Reports the Turbo cache hit rate per job.',
      risk: 'Low.', othersSaid: 'rowan asked about cold runs.',
    }),
    sampleGlance(clock, 2021, {
      verdict: 'LOOKS_SAFE', forYou: 'You approved.', does: 'Sends the hit rates to the CI dashboard.',
      risk: 'Low.', othersSaid: 'rowan checked the panel on staging.',
    }),
  ];
}

function buildTiles() {
  const single = (topicId: string, number: number, title: string, member = pinged(number, 'subscribed')) =>
    sampleTile(topicId, 'single', `pr:${sampleKey(number)}`, title, [member]);
  return [
    single(BOARD_TOPIC.releaseNotes, 2001, 'Your release notes script is approved', pinged(2001, 'author')),
    single(BOARD_TOPIC.locale, 2002, 'Locale files moved', pinged(2002, 'author')),
    single(BOARD_TOPIC.searchRelevance, 2003, 'lyra merged your search boost', pinged(2003, 'author')),
    single(BOARD_TOPIC.docsLint, 2004, 'Your docs link check is a draft', found(2004, 'own_open', 'your open PR')),
    single(BOARD_TOPIC.docsLint, 2005, 'Heading level lint merged', pinged(2005, 'author')),
    single(BOARD_TOPIC.docsLint, 2006, 'Trailing space lint merged', pinged(2006, 'author')),
    single(BOARD_TOPIC.devboxPrebuilds, 2010, 'sol asks you to look at a draft', pinged(2010, 'review_requested')),
    single(BOARD_TOPIC.testTimeouts, 2012, 'nell says the 10s timeout is fine', pinged(2012, 'comment')),
    single(BOARD_TOPIC.testTimeouts, 2013, 'lyra asks about the e2e limit', pinged(2013, 'mention')),
    single(BOARD_TOPIC.mergedAway, 2014, 'YAML lint on changed files merged', pinged(2014, 'review_requested')),
    single(BOARD_TOPIC.logFormat, 2015, 'JSON worker logs closed', pinged(2015, 'review_requested')),
    single(BOARD_TOPIC.logFormat, 2016, 'JSON worker logs behind a flag'),
    single(BOARD_TOPIC.releaseTrain, 2017, 'Release 2026.40 cut', pinged(2017, 'review_requested')),
    single(BOARD_TOPIC.prTemplate, 2019, 'Your template check waits on four reviewers', found(2019, 'own_open', 'your open PR')),
    single(BOARD_TOPIC.cacheMetrics, 2020, 'Cache hit rate report, approved', pinged(2020, 'review_requested')),
    single(BOARD_TOPIC.cacheMetrics, 2021, 'Cache dashboard panel, approved', pinged(2021, 'review_requested')),
  ];
}

export function boardPack(clock: SampleClock): SamplePack {
  return {
    topics: buildTopics(clock),
    prs: buildPrs(clock),
    events: buildEvents(clock),
    glances: buildGlances(clock),
    tiles: buildTiles(),
    sets: [],
    userStates: [
      approvedState(2020, clock.hoursAgo(2)),
      // Opened in PostPile between rowan's comment and the approval.
      approvedState(2021, clock.hoursAgo(3), clock.hoursAgo(3.001)),
    ],
  };
}

/** Only the standing topic needs a relation: the others place by their driver. */
export function boardPackMemory(): SamplePackMemory {
  return {
    relations: new Map([[BOARD_TOPIC.releaseTrain, { kind: 'team', ownerTeam: 'acme/team-platform', whyYou: 'your team cuts the releases' }]]),
    dossiers: new Map(),
  };
}
