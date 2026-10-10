// POSTPILE_FAKE_EXTRA=stacks: stacks and a bot set the default sample does
// not have (the bug-hunt's WP4). Each stack is declared on its tile, like the
// Depot stack in sample-data.ts; branches chain the layers bottom first.
//
// - Search ranking: rowan's 3 layers, bottom approved by sol, middle asks
//   you, top a draft; glances mixed.
// - Search indexing: lyra's 3 open layers, nell reviews, all unread, none
//   your move.
// - Session export: sol's 2 layers, you approved the bottom, the top waits
//   on team-security, a team you are not on. Next to it your own 2 layers
//   in the same shape, where the tile reads "Blocked: team-security to
//   review #2124" (someone else's stack keeps "sol to merge", DESIGN.md
//   "Stacks land together").
// - Query result cache: rowan's 3 layers (safe, look closer, safe) and
//   nell's 2 (both safe), all asking you, for the agent-backed Approve.
// - Flag cleanup: nell's 3 layers with only the middle one merged.
// - Lockfile bumps: a set of 5 renovate[bot] PRs plus one single bump.
import type { FullPr, Glance, PrEvent, PrSet, Tile, Topic, UserPrState } from '@postpile/core';
import {
  pinged,
  SAMPLE_VIEWER,
  SampleClock,
  sampleEvents,
  sampleGlance,
  sampleKey,
  samplePr,
  sampleTile,
  sampleTopic,
} from './sample-builders.ts';
import type { SamplePack } from './sample-pack-common.ts';

const TOPIC = {
  ranking: 'topic-search-ranking',
  indexing: 'topic-search-indexing',
  export: 'topic-session-export',
  queryCache: 'topic-query-cache',
  flags: 'topic-flag-cleanup',
  lockfile: 'topic-lockfile-bumps',
};

const RENOVATE = 'renovate[bot]';

function buildTopics(clock: SampleClock): Topic[] {
  return [
    sampleTopic(clock, {
      id: TOPIC.ranking,
      area: 'Search',
      name: 'Search ranking',
      summary: 'rowan replaces the ranking with BM25 blended with click-through, in three layers.',
      tailoring: '',
      driver: 'rowan',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.indexing,
      area: 'Search',
      name: 'Search indexing',
      summary: 'lyra splits the indexer into stages. nell reviews.',
      tailoring: '',
      driver: 'lyra',
      userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: TOPIC.export,
      area: 'Replay',
      name: 'Session export',
      summary: 'sol streams session exports in chunks and resumes interrupted ones.',
      tailoring: '',
      driver: 'sol',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.queryCache,
      area: 'Search',
      name: 'Query result cache',
      summary: 'rowan adds a result cache for slow queries; nell adds the metrics for it.',
      tailoring: '',
      driver: 'rowan',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.flags,
      area: null,
      name: 'Flag cleanup',
      summary: 'nell removes three old feature flags. The middle layer was merged on its own.',
      tailoring: '',
      driver: 'nell',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.lockfile,
      area: 'Dev env',
      name: 'Lockfile bumps',
      summary: 'renovate bumps dev dependencies, one PR per package.',
      tailoring: '',
      driver: null,
      userRole: 'watcher',
    }),
  ];
}

function buildRankingPrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2101, title: 'Add a BM25 scorer behind a flag', author: 'rowan', state: 'OPEN',
      size: [140, 6, 4], openedHoursAgo: 30,
      baseRef: 'master', headRef: 'rowan/ranking-1',
      reviews: [['sol', 'APPROVED', 'Scorer matches the defaults from the paper.', undefined, 6]],
      comments: [{ id: 'issuecomment-2101-1', author: 'sol', body: 'Benchmarks look fine on the staging index.', hoursAgo: 7 }],
    }),
    samplePr(clock, {
      number: 2102, title: 'Blend BM25 with click-through signals', author: 'rowan', state: 'OPEN',
      size: [96, 20, 3], openedHoursAgo: 26,
      baseRef: 'rowan/ranking-1', headRef: 'rowan/ranking-2', reviewerUsers: [SAMPLE_VIEWER],
      comments: [{ id: 'issuecomment-2102-1', author: 'nell', body: 'Do we cap the click-through weight? One viral query could take over the results.', hoursAgo: 1 }],
    }),
    samplePr(clock, {
      number: 2103, title: 'Tune ranking weights per locale', author: 'rowan', state: 'OPEN', draft: true,
      size: [44, 10, 2], openedHoursAgo: 4,
      baseRef: 'rowan/ranking-2', headRef: 'rowan/ranking-3',
      comments: [{ id: 'issuecomment-2103-1', author: 'rowan', body: 'Draft until the German weights are measured.', hoursAgo: 4 }],
    }),
  ];
}

function buildIndexingPrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2111, title: 'Split the indexer into fetch and write stages', author: 'lyra', state: 'OPEN',
      size: [120, 80, 5], openedHoursAgo: 20,
      baseRef: 'master', headRef: 'lyra/indexing-1', reviewerUsers: ['nell'],
      comments: [{ id: 'issuecomment-2111-1', author: 'nell', body: 'Should the write stage retry on its own?', hoursAgo: 2 }],
    }),
    samplePr(clock, {
      number: 2112, title: 'Batch index writes by 500 documents', author: 'lyra', state: 'OPEN',
      size: [40, 12, 2], openedHoursAgo: 18,
      baseRef: 'lyra/indexing-1', headRef: 'lyra/indexing-2', reviewerUsers: ['nell'],
      comments: [{ id: 'issuecomment-2112-1', author: 'sizebot[bot]', body: 'indexer.js +1.2 kB', hoursAgo: 1.5 }],
    }),
    samplePr(clock, {
      number: 2113, title: 'Drop the old single-stage indexer', author: 'lyra', state: 'OPEN',
      size: [0, 210, 6], openedHoursAgo: 16,
      baseRef: 'lyra/indexing-2', headRef: 'lyra/indexing-3', reviewerUsers: ['nell'],
      comments: [{ id: 'issuecomment-2113-1', author: 'nell', body: 'Fine to drop once the batch layer is in.', hoursAgo: 0.8 }],
    }),
  ];
}

function buildExportPrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2121, title: 'Stream session exports in chunks', author: 'sol', state: 'OPEN',
      size: [88, 30, 4], openedHoursAgo: 10,
      baseRef: 'master', headRef: 'sol/export-1',
      reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 3]],
    }),
    samplePr(clock, {
      number: 2122, title: 'Resume interrupted session exports', author: 'sol', state: 'OPEN',
      size: [64, 8, 3], openedHoursAgo: 9,
      baseRef: 'sol/export-1', headRef: 'sol/export-2', reviewerTeams: ['acme/team-security'],
    }),
    samplePr(clock, {
      number: 2123, title: 'Add an export size limit per team', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [26, 4, 2], openedHoursAgo: 8,
      baseRef: 'master', headRef: 'you/export-limit-1',
      reviews: [['lyra', 'APPROVED', '', undefined, 2]],
    }),
    samplePr(clock, {
      number: 2124, title: 'Show the export size limit in settings', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [40, 2, 3], openedHoursAgo: 7,
      baseRef: 'you/export-limit-1', headRef: 'you/export-limit-2', reviewerTeams: ['acme/team-security'],
    }),
  ];
}

function buildQueryCachePrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2131, title: 'Add a query result cache table', author: 'rowan', state: 'OPEN',
      size: [36, 0, 2], openedHoursAgo: 12,
      baseRef: 'master', headRef: 'rowan/qcache-1', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 2132, title: 'Cache results keyed by query hash', author: 'rowan', state: 'OPEN',
      size: [150, 40, 6], openedHoursAgo: 11,
      baseRef: 'rowan/qcache-1', headRef: 'rowan/qcache-2', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 2133, title: 'Expire cached results on deploy', author: 'rowan', state: 'OPEN',
      size: [18, 2, 2], openedHoursAgo: 10,
      baseRef: 'rowan/qcache-2', headRef: 'rowan/qcache-3', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 2141, title: 'Log cache hits per query kind', author: 'nell', state: 'OPEN',
      size: [22, 2, 2], openedHoursAgo: 8,
      baseRef: 'master', headRef: 'nell/qcache-metrics-1', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 2142, title: 'Graph the cache hit rate on the ops board', author: 'nell', state: 'OPEN',
      size: [30, 0, 1], openedHoursAgo: 7,
      baseRef: 'nell/qcache-metrics-1', headRef: 'nell/qcache-metrics-2', reviewerUsers: [SAMPLE_VIEWER],
    }),
  ];
}

function buildFlagPrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2151, title: 'Remove the old onboarding flag', author: 'nell', state: 'OPEN',
      size: [12, 60, 5], openedHoursAgo: 30,
      baseRef: 'master', headRef: 'nell/flags-1', reviewerUsers: ['sol'],
      comments: [{ id: 'issuecomment-2151-1', author: 'sol', body: 'Onboarding still reads it in one test.', hoursAgo: 20 }],
    }),
    // Merged into the layer below's branch, not master: the middle of the stack landed first.
    samplePr(clock, {
      number: 2152, title: 'Remove the billing banner flag', author: 'nell', state: 'MERGED',
      size: [4, 38, 3], openedHoursAgo: 28, mergedHoursAgo: 6,
      baseRef: 'nell/flags-1', headRef: 'nell/flags-2', reviews: [['sol', 'APPROVED', '', undefined, 8]],
    }),
    samplePr(clock, {
      number: 2153, title: 'Drop the flag client fallback', author: 'nell', state: 'OPEN',
      size: [8, 44, 4], openedHoursAgo: 5,
      baseRef: 'nell/flags-2', headRef: 'nell/flags-3', reviewerUsers: [SAMPLE_VIEWER],
    }),
  ];
}

function buildLockfilePrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 2161, title: 'Update dependency eslint to v9.12', author: RENOVATE, state: 'OPEN',
      size: [6, 6, 2], openedHoursAgo: 20, reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 2162, title: 'Update dependency vitest to v4.1', author: RENOVATE, state: 'OPEN',
      size: [8, 8, 2], openedHoursAgo: 19, reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 2163, title: 'Update dependency typescript to v5.9', author: RENOVATE, state: 'OPEN',
      size: [4, 4, 2], openedHoursAgo: 18, reviews: [['nell', 'APPROVED', '', undefined, 5]],
    }),
    samplePr(clock, {
      number: 2164, title: 'Update dependency prettier to v3.6', author: RENOVATE, state: 'MERGED',
      size: [4, 4, 2], openedHoursAgo: 17, mergedHoursAgo: 4, reviews: [['lyra', 'APPROVED', '', undefined, 6]],
    }),
    samplePr(clock, {
      number: 2165, title: 'Lock file maintenance', author: RENOVATE, state: 'OPEN',
      size: [310, 290, 1], openedHoursAgo: 3,
    }),
    samplePr(clock, {
      number: 2166, title: 'Update dependency node to v22.11', author: RENOVATE, state: 'OPEN',
      size: [3, 3, 3], openedHoursAgo: 2,
    }),
  ];
}

function buildPrs(clock: SampleClock): FullPr[] {
  return [
    ...buildRankingPrs(clock),
    ...buildIndexingPrs(clock),
    ...buildExportPrs(clock),
    ...buildQueryCachePrs(clock),
    ...buildFlagPrs(clock),
    ...buildLockfilePrs(clock),
  ];
}

/** renovate opening a PR: a quiet bot push, unread like on GitHub. */
function renovateOpened(clock: SampleClock, number: number, hoursAgo: number): PrEvent[] {
  return sampleEvents(clock, number, [{ kind: 'commits_pushed', actor: RENOVATE, text: 'opened the PR', hoursAgo, rule: 'quiet', isBot: true }]);
}

function buildEvents(clock: SampleClock): PrEvent[] {
  return [
    ...sampleEvents(clock, 2101, [
      { kind: 'comment', actor: 'sol', text: 'commented: "Benchmarks look fine on the staging index."', hoursAgo: 7, rule: 'quiet', sourceId: 'issuecomment-2101-1', seen: true },
      { kind: 'review_approved', actor: 'sol', text: 'approved', hoursAgo: 6, rule: 'quiet', sourceId: 'review-2101-0', seen: true },
    ]),
    ...sampleEvents(clock, 2102, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 3, rule: 'loud' },
      { kind: 'comment', actor: 'nell', text: 'commented: "Do we cap the click-through weight?"', hoursAgo: 1, rule: 'quiet', sourceId: 'issuecomment-2102-1' },
    ]),
    ...sampleEvents(clock, 2103, [
      { kind: 'comment', actor: 'rowan', text: 'commented: "Draft until the German weights are measured."', hoursAgo: 4, rule: 'quiet', sourceId: 'issuecomment-2103-1', seen: true },
    ]),
    ...sampleEvents(clock, 2111, [
      { kind: 'comment', actor: 'nell', text: 'commented: "Should the write stage retry on its own?"', hoursAgo: 2, rule: 'quiet', sourceId: 'issuecomment-2111-1' },
    ]),
    ...sampleEvents(clock, 2112, [
      { kind: 'bot_comment', actor: 'sizebot[bot]', text: 'commented: "indexer.js +1.2 kB"', hoursAgo: 1.5, rule: 'quiet', sourceId: 'issuecomment-2112-1', isBot: true },
    ]),
    ...sampleEvents(clock, 2113, [
      { kind: 'comment', actor: 'nell', text: 'commented: "Fine to drop once the batch layer is in."', hoursAgo: 0.8, rule: 'quiet', sourceId: 'issuecomment-2113-1' },
    ]),
    ...sampleEvents(clock, 2121, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from you', hoursAgo: 9, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 3, rule: 'quiet', sourceId: 'review-2121-0', seen: true },
    ]),
    ...sampleEvents(clock, 2122, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from acme/team-security', hoursAgo: 8, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 2123, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 2, rule: 'loud', sourceId: 'review-2123-0', seen: true },
    ]),
    ...sampleEvents(clock, 2131, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 12, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 2132, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 11, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 2133, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 10, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 2141, [
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 8, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 2142, [
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 7, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 2151, [
      { kind: 'comment', actor: 'sol', text: 'commented: "Onboarding still reads it in one test."', hoursAgo: 20, rule: 'quiet', sourceId: 'issuecomment-2151-1', seen: true },
    ]),
    ...sampleEvents(clock, 2152, [
      { kind: 'review_approved', actor: 'sol', text: 'approved', hoursAgo: 8, rule: 'quiet', sourceId: 'review-2152-0', seen: true },
      { kind: 'merged', actor: 'nell', text: 'merged', hoursAgo: 6, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 2153, [
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 5, rule: 'loud' },
    ]),
    ...renovateOpened(clock, 2161, 20),
    ...renovateOpened(clock, 2162, 19),
    ...sampleEvents(clock, 2163, [
      { kind: 'commits_pushed', actor: RENOVATE, text: 'opened the PR', hoursAgo: 18, rule: 'quiet', isBot: true, seen: true },
      { kind: 'review_approved', actor: 'nell', text: 'approved', hoursAgo: 5, rule: 'quiet', sourceId: 'review-2163-0', seen: true },
    ]),
    ...sampleEvents(clock, 2164, [
      { kind: 'commits_pushed', actor: RENOVATE, text: 'opened the PR', hoursAgo: 17, rule: 'quiet', isBot: true, seen: true },
      { kind: 'merged', actor: RENOVATE, text: 'merged', hoursAgo: 4, rule: 'quiet', isBot: true, seen: true },
    ]),
    ...renovateOpened(clock, 2165, 3),
    ...renovateOpened(clock, 2166, 2),
  ];
}

function buildGlances(clock: SampleClock): Glance[] {
  const safe = (number: number, does: string): Glance =>
    sampleGlance(clock, number, { verdict: 'LOOKS_SAFE', forYou: 'Nothing here you asked to hear about.', does, risk: 'Low.', othersSaid: 'No comments yet.' });
  return [
    safe(2101, 'Adds a BM25 scorer, off by default.'),
    sampleGlance(clock, 2102, {
      verdict: 'LOOK_CLOSER',
      forYou: 'rowan asks you; nell asks whether the click-through weight is capped.',
      does: 'Blends BM25 scores with click-through rates.',
      risk: 'Medium. One popular query could dominate results.',
      othersSaid: 'nell asked about a cap.',
    }),
    safe(2103, 'Reads ranking weights per locale from config.'),
    safe(2111, 'Splits the indexer into a fetch stage and a write stage.'),
    safe(2112, 'Writes index updates in batches of 500.'),
    safe(2113, 'Deletes the old single-stage indexer.'),
    safe(2121, 'Streams exports in 5 MB chunks instead of one file.'),
    safe(2122, 'Resumes an export from its last finished chunk.'),
    safe(2123, 'Caps exports at 2 GB per team.'),
    safe(2124, 'Shows the export limit on the settings page.'),
    safe(2131, 'Adds the cache table and its migration.'),
    sampleGlance(clock, 2132, {
      verdict: 'LOOK_CLOSER',
      forYou: 'The cache key leaves out the team id.',
      does: 'Caches query results keyed by a hash of the query text.',
      risk: 'High. Two teams with the same query could share results.',
      othersSaid: 'No comments yet.',
    }),
    safe(2133, 'Clears the cache table on every deploy.'),
    safe(2141, 'Logs a cache hit or miss per query kind.'),
    safe(2142, 'Adds a hit-rate panel to the ops board.'),
    safe(2151, 'Removes the onboarding flag and its checks.'),
    safe(2153, 'Removes the client fallback for flags that no longer exist.'),
    safe(2161, 'Minor eslint bump.'),
    safe(2162, 'Minor vitest bump.'),
    safe(2163, 'Minor TypeScript bump.'),
    safe(2165, 'Refreshes the lockfile.'),
    safe(2166, 'Patch bump of the Node version in .nvmrc and the CI images.'),
  ];
}

function buildTiles(): Tile[] {
  return [
    sampleTile(TOPIC.ranking, 'stack', `stack:${sampleKey(2101)}`, 'rowan/ranking: the blend layer waits on you', [
      pinged(2101, 'subscribed'),
      pinged(2102, 'review_requested'),
      pinged(2103, 'subscribed'),
    ]),
    sampleTile(TOPIC.indexing, 'stack', `stack:${sampleKey(2111)}`, 'lyra/indexing: nell reviews three layers', [
      pinged(2111, 'subscribed'),
      pinged(2112, 'subscribed'),
      pinged(2113, 'subscribed'),
    ]),
    sampleTile(TOPIC.export, 'stack', `stack:${sampleKey(2121)}`, 'sol/export: the resume layer waits on team-security', [
      pinged(2121, 'review_requested'),
      pinged(2122, 'subscribed'),
    ]),
    sampleTile(TOPIC.export, 'stack', `stack:${sampleKey(2123)}`, 'Your export limit stack waits on team-security', [
      pinged(2123, 'author'),
      pinged(2124, 'author'),
    ]),
    sampleTile(TOPIC.queryCache, 'stack', `stack:${sampleKey(2131)}`, 'rowan/qcache: three layers wait on you', [
      pinged(2131, 'review_requested'),
      pinged(2132, 'review_requested'),
      pinged(2133, 'review_requested'),
    ]),
    sampleTile(TOPIC.queryCache, 'stack', `stack:${sampleKey(2141)}`, 'nell/qcache-metrics: two small layers wait on you', [
      pinged(2141, 'review_requested'),
      pinged(2142, 'review_requested'),
    ]),
    sampleTile(TOPIC.flags, 'stack', `stack:${sampleKey(2151)}`, 'nell/flags: the middle layer landed first', [
      pinged(2151, 'subscribed'),
      pinged(2152, 'subscribed'),
      pinged(2153, 'review_requested'),
    ]),
    sampleTile(TOPIC.lockfile, 'set', 'set:lockfile-bumps', 'Five renovate bumps of dev dependencies', [
      pinged(2161, 'review_requested'),
      pinged(2162, 'review_requested'),
      pinged(2163, 'subscribed'),
      pinged(2164, 'subscribed'),
      pinged(2165, 'subscribed'),
    ]),
    sampleTile(TOPIC.lockfile, 'single', `pr:${sampleKey(2166)}`, 'Node 22.11 bump', [pinged(2166, 'subscribed')]),
  ];
}

function buildSets(clock: SampleClock): PrSet[] {
  const member = (number: number, reason: string) => ({ prKey: sampleKey(number), reason });
  return [
    {
      id: 'lockfile-bumps',
      topicId: TOPIC.lockfile,
      title: 'Five renovate bumps of dev dependencies',
      take: 'All five only touch dev dependencies and the lockfile; review them in one go.',
      members: [
        member(2161, 'Bumps eslint.'),
        member(2162, 'Bumps vitest.'),
        member(2163, 'Bumps TypeScript.'),
        member(2164, 'Bumped prettier, merged.'),
        member(2165, 'Refreshes the lockfile.'),
      ],
      removedKeys: [],
      status: 'active',
      inputHash: 'sample',
      createdAt: clock.hoursAgo(3),
      updatedAt: clock.hoursAgo(3),
    },
  ];
}

function buildUserStates(clock: SampleClock): UserPrState[] {
  return [{ prKey: sampleKey(2121), approvedAt: clock.hoursAgo(3), approvedCommitOid: 'sha2121', handledAt: null }];
}

export function stacksPack(clock: SampleClock): SamplePack {
  return {
    topics: buildTopics(clock),
    prs: buildPrs(clock),
    events: buildEvents(clock),
    glances: buildGlances(clock),
    tiles: buildTiles(),
    sets: buildSets(clock),
    userStates: buildUserStates(clock),
  };
}
