// The "Move CI to Depot" sample from the design rounds, as domain objects.
// Used by FakeEngine so the server, CLI and desktop app run without GitHub or
// the agent.
import type { Glance, Pr, PrEvent, PrKey, PrSet, Tile, Topic, TopicProposal, UserPrState } from '@code-manager/core';
import {
  pinged,
  pulledIn,
  SAMPLE_VIEWER,
  SampleClock,
  sampleEvents,
  sampleGlance,
  sampleKey,
  samplePr,
  sampleTile,
  sampleTopic,
} from './sample-builders.ts';

export interface SampleData {
  viewer: string;
  /** The viewer's teams, as GitHub names them ("org/slug"). */
  viewerTeams: string[];
  /** Everyone else on those teams, like the engine's daily team-member fetch. */
  viewerTeamMembers: string[];
  topics: Topic[];
  prs: Pr[];
  events: PrEvent[];
  glances: Glance[];
  tiles: Tile[];
  sets: PrSet[];
  proposals: TopicProposal[];
  userStates: UserPrState[];
  /** PR -> topic. PRs pulled into another topic's tile keep their own topic. */
  membership: Map<PrKey, string>;
}

const TOPIC = {
  depot: 'topic-depot',
  ci: 'topic-ci-tests',
  migrations: 'topic-migrations',
  devEnv: 'topic-dev-env',
  frontend: 'topic-frontend-build',
  deps: 'topic-dependency-bumps',
  ingestion: 'topic-ingestion-runners',
  desktop: 'topic-desktop-release',
};

function buildTopics(clock: SampleClock): Topic[] {
  return [
    sampleTopic(clock, {
      id: TOPIC.depot,
      area: 'CI',
      name: 'Move CI to Depot',
      summary: 'Backend and frontend run on Depot. Turbo caching and e2e are in flight. The release workflow has no PR yet.',
      tailoring: 'Rowan drives, I approve. Flag cache keys, runner labels, secrets.',
      driver: 'rowan',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.ci,
      area: 'CI',
      name: 'CI & tests',
      summary: 'Shard splitting is being reworked. One PR merged without you and raises a limit you set.',
      tailoring: 'Anything that loosens CI limits goes to the top.',
      driver: SAMPLE_VIEWER,
      userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: TOPIC.migrations,
      area: 'Dev env',
      name: 'Migrations',
      summary: 'error_tracking is waiting on one answer from you. Surveys moved and was fixed.',
      tailoring: 'Tell me when a migration touches real tables.',
      driver: SAMPLE_VIEWER,
      userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: TOPIC.devEnv,
      area: 'Dev env',
      name: 'Dev env',
      summary: 'Mostly version bumps. One change to hogli defaults waits for a reviewer.',
      tailoring: 'Anything that changes hogli defaults goes to the top.',
      driver: SAMPLE_VIEWER,
      userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: TOPIC.frontend,
      area: 'Frontend',
      name: 'Frontend build',
      summary: 'Vite 7 upgrade merged; jude asked about snapshots after the merge.',
      tailoring: 'Only cache changes.',
      driver: 'lyra',
      userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: TOPIC.deps,
      area: 'Dev env',
      name: 'Dependency bumps',
      summary: 'Bot PRs, all green.',
      tailoring: 'Never ping me for these.',
      driver: null,
      userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: TOPIC.ingestion,
      area: 'CI',
      name: 'Ingestion CI runners RFC',
      summary: 'Ingestion wants its own self-hosted runners and asks devex to review the workflow part.',
      tailoring: '',
      driver: 'ines',
      userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: TOPIC.desktop,
      area: 'Desktop',
      name: 'Desktop app release',
      summary: 'The desktop team is cutting 2.3. You follow the release thread.',
      tailoring: '',
      driver: 'mae',
      userRole: 'watcher',
    }),
  ];
}

function buildPrs(clock: SampleClock): Pr[] {
  return [
    samplePr(clock, {
      number: 41902, title: 'Use Depot cache backend for Turbo', author: 'rowan', state: 'OPEN',
      size: [186, 42, 7], checks: 'FAILURE', openedHoursAgo: 5,
      baseRef: 'rowan/depot-2', headRef: 'rowan/depot-3',
      reviews: [
        ['lyra', 'APPROVED', 'Cache config looks right. The warm-up job is the only open point.'],
        ['nell', 'COMMENTED', 'The first run after merge took 38 min on my fork.'],
      ],
      reviewerUsers: [SAMPLE_VIEWER], reviewerTeams: ['PostHog/team-devex'],
      comments: [{ id: 'issuecomment-2', author: 'lyra', body: '@you does the warm-up job need a feature flag, or is one cold hour fine?', hoursAgo: 0.3 }],
      threads: [
        {
          id: 'thread-41902-1',
          path: 'turbo.json',
          comments: [{ author: 'nell', body: 'Does the cache key include the runner image?', hoursAgo: 2 }],
        },
      ],
      commits: [
        { oid: 'a1b2c3', headline: 'Warm the Turbo cache on the first run', hoursAgo: 4 },
        { oid: 'sha41902', headline: 'Retry the warm-up once before failing', hoursAgo: 0.5 },
      ],
    }),
    samplePr(clock, {
      number: 41921, title: 'Bump turbo to 2.5', author: 'renovate[bot]', state: 'OPEN',
      size: [4, 4, 2], checks: 'SUCCESS', openedHoursAgo: 3, reviewerTeams: ['PostHog/team-devex'],
    }),
    samplePr(clock, {
      number: 41855, title: 'Skip Turbo remote cache for Storybook', author: 'jude', state: 'MERGED',
      size: [3, 1, 1], checks: 'SUCCESS', openedHoursAgo: 30, mergedHoursAgo: 14, reviews: [['lyra', 'APPROVED']],
      comments: [{ id: 'issuecomment-3', author: 'jude', body: 'Are the snapshots stale because of the cache or because of the Vite upgrade?', hoursAgo: 16 }],
    }),
    samplePr(clock, {
      number: 41911, title: 'Run e2e on Depot runners', author: 'rowan', state: 'OPEN',
      size: [48, 48, 5], checks: 'SUCCESS', openedHoursAgo: 6,
      baseRef: 'rowan/depot-3', headRef: 'rowan/depot-4', reviewerUsers: ['nell'],
      reviews: [[SAMPLE_VIEWER, 'APPROVED', 'Labels match #41880.', 'sha41911-a']],
      commits: [
        { oid: 'sha41911-a', headline: 'Move Playwright jobs to Depot', hoursAgo: 5 },
        { oid: 'sha41911-b', headline: 'Bump Playwright shard count to 6', hoursAgo: 0.25 },
        { oid: 'sha41911', headline: 'Pin the Depot runner image', hoursAgo: 0.15 },
      ],
    }),
    samplePr(clock, {
      number: 41862, title: 'Backend jobs on Depot', author: 'rowan', state: 'MERGED',
      size: [60, 60, 6], checks: 'SUCCESS', openedHoursAgo: 96, mergedHoursAgo: 72,
      baseRef: 'rowan/depot-1', headRef: 'rowan/depot-2',
      reviews: [[SAMPLE_VIEWER, 'APPROVED'], ['lyra', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 41851, title: 'Add Depot project config', author: 'rowan', state: 'MERGED',
      size: [12, 0, 1], checks: 'SUCCESS', openedHoursAgo: 170, mergedHoursAgo: 144,
      baseRef: 'master', headRef: 'rowan/depot-1', reviews: [[SAMPLE_VIEWER, 'APPROVED']],
      comments: [{ id: 'issuecomment-1', author: 'nell', body: 'Can we keep GitHub runners for release builds until Depot has an SLA?', hoursAgo: 150 }],
    }),
    samplePr(clock, {
      number: 41915, title: 'DEPOT_TOKEN as repo secret', author: 'rowan', state: 'MERGED',
      size: [9, 3, 3], checks: 'SUCCESS', openedHoursAgo: 30, mergedHoursAgo: 24, reviews: [['lyra', 'APPROVED']],
      comments: [{ id: 'issuecomment-4', author: 'rowan', body: 'Keeping DEPOT_TOKEN a repo secret for now. The org secret move comes with the release workflow.', hoursAgo: 25 }],
    }),
    samplePr(clock, {
      number: 41899, title: 'Rename workflow files to ci-*.yml', author: 'rowan', state: 'OPEN',
      size: [0, 0, 9], checks: 'SUCCESS', openedHoursAgo: 48, queued: true,
      reviews: [[SAMPLE_VIEWER, 'APPROVED'], ['lyra', 'APPROVED'], ['nell', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 41790, title: 'Raise Django test timeout to 45 min', author: 'nell', state: 'MERGED',
      size: [1, 1, 1], checks: 'SUCCESS', openedHoursAgo: 60, mergedHoursAgo: 48, reviews: [['rowan', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 41822, title: 'Split backend tests by timing data', author: 'remy', state: 'OPEN',
      size: [240, 80, 11], checks: 'SUCCESS', openedHoursAgo: 72,
      reviews: [['lyra', 'APPROVED'], ['sol', 'APPROVED']], reviewerTeams: ['PostHog/team-devex'],
    }),
    samplePr(clock, {
      number: 41801, title: 'Move error_tracking models to products/', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [410, 380, 24], checks: 'SUCCESS', openedHoursAgo: 48,
      reviews: [['ada', 'CHANGES_REQUESTED'], ['lyra', 'APPROVED']],
      threads: [
        {
          id: 'thread-41801-1',
          path: 'products/error_tracking/backend/models.py',
          comments: [{ author: 'ada', body: 'Keep db_table so the move stays state-only?', hoursAgo: 26 }],
        },
        {
          id: 'thread-41801-2',
          path: 'posthog/models/__init__.py',
          comments: [{ author: 'ada', body: 'This re-export hides the new path.', hoursAgo: 26 }],
        },
        {
          id: 'thread-41801-3',
          path: 'products/error_tracking/backend/apps.py',
          comments: [
            { author: 'lyra', body: 'Label clash with the old app?', hoursAgo: 30 },
            { author: SAMPLE_VIEWER, body: 'No, the label is new.', hoursAgo: 29 },
          ],
          resolved: true,
        },
      ],
    }),
    samplePr(clock, {
      number: 41930, title: 'RFC: self-hosted runners for ingestion CI', author: 'ines', state: 'OPEN',
      size: [140, 12, 3], checks: 'SUCCESS', openedHoursAgo: 20, reviewerTeams: ['PostHog/team-devex'],
      body: 'Ingestion jobs need more memory than Depot offers. This RFC adds a runner pool and one workflow change.',
    }),
    samplePr(clock, {
      number: 41940, title: 'Release desktop 2.3', author: 'mae', state: 'OPEN',
      size: [30, 10, 4], checks: 'PENDING', openedHoursAgo: 30, reviews: [['koa', 'APPROVED']],
    }),
    // Added for the sidebar's queue sections: your own PRs (My PRs), a team
    // mention (Team mentioned), a bot bump (Other topics) and a merged PR with
    // news on it (unread, but calm).
    samplePr(clock, {
      number: 41945, title: 'Cap CI shard retries at 2', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [14, 6, 2], checks: 'SUCCESS', openedHoursAgo: 8, reviewerUsers: ['lyra'],
      reviews: [['remy', 'COMMENTED', 'Would 3 hide fewer real flakes?']],
    }),
    samplePr(clock, {
      number: 41808, title: 'Drop the old error_tracking re-exports', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [3, 40, 2], checks: 'SUCCESS', openedHoursAgo: 20, reviews: [['nell', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 41934, title: 'Ingestion runner pool as a Terraform module', author: 'ines', state: 'OPEN',
      size: [220, 0, 6], checks: 'SUCCESS', openedHoursAgo: 10,
      comments: [{ id: 'issuecomment-5', author: 'ines', body: '@PostHog/team-devex do the runner labels clash with yours?', hoursAgo: 1.5 }],
    }),
    samplePr(clock, {
      number: 41925, title: 'Bump ruff to 0.7', author: 'renovate[bot]', state: 'OPEN',
      size: [2, 2, 1], checks: 'SUCCESS', openedHoursAgo: 12,
    }),
    samplePr(clock, {
      number: 41857, title: 'Upgrade to Vite 7', author: 'lyra', state: 'MERGED',
      size: [120, 90, 14], checks: 'SUCCESS', openedHoursAgo: 50, mergedHoursAgo: 3, reviews: [['jude', 'APPROVED']],
      comments: [{ id: 'issuecomment-6', author: 'jude', body: '@you are the stale snapshots gone after this?', hoursAgo: 2 }],
    }),
    samplePr(clock, {
      number: 41870, title: 'Make hogli start default to minimal stack', author: 'sol', state: 'OPEN',
      size: [70, 12, 4], checks: 'SUCCESS', openedHoursAgo: 72, reviewerTeams: ['PostHog/team-devex'],
    }),
  ];
}

function buildEvents(clock: SampleClock): PrEvent[] {
  return [
    ...sampleEvents(clock, 41902, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested your review', hoursAgo: 5, rule: 'loud', seen: true },
      { kind: 'deploy', actor: 'deploy-bot', text: 'deployed a preview', hoursAgo: 1, rule: 'quiet', isBot: true },
      { kind: 'mention', actor: 'lyra', text: 'mentioned you: "does the warm-up need a flag?"', hoursAgo: 0.3, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41921, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'opened the PR', hoursAgo: 3, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 41855, [
      { kind: 'merged', actor: 'jude', text: 'merged it', hoursAgo: 14, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 41911, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested your review', hoursAgo: 6, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 4, rule: 'quiet', seen: true },
      { kind: 'commits_after_approval', actor: 'rowan', text: 'pushed "Bump Playwright shard count to 6" after your approval', hoursAgo: 0.25, rule: 'loud' },
      { kind: 'commits_after_approval', actor: 'rowan', text: 'pushed "Pin the Depot runner image" after your approval', hoursAgo: 0.15, rule: 'loud' },
      { kind: 'ci', actor: 'ci-bot', text: 'all checks passed', hoursAgo: 0.1, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 41862, [
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 72, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 41851, [
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 144, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 41915, [
      { kind: 'team_mention', actor: 'rowan', text: 'mentioned @team-devex', hoursAgo: 24, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41899, [
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 24, rule: 'quiet', seen: true },
      {
        kind: 'force_pushed', actor: 'renovate[bot]', text: 'rebased', hoursAgo: 3, rule: 'quiet', isBot: true,
        mutedBecause: 'Bot rebase, no content change.',
      },
      { kind: 'merge_queue', actor: 'mergify[bot]', text: 'queued for merge', hoursAgo: 1, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 41790, [
      { kind: 'merged_without_review', actor: 'nell', text: 'merged it without your review', hoursAgo: 48, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41822, [
      { kind: 'review_requested', actor: 'remy', text: 'requested @team-devex', hoursAgo: 72, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41801, [
      { kind: 'question_to_user', actor: 'ada', text: 'asked "is this reversible?"', hoursAgo: 24, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41930, [
      { kind: 'review_requested', actor: 'ines', text: 'requested @team-devex', hoursAgo: 2, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41940, [
      { kind: 'comment', actor: 'mae', text: 'commented: "2.3 goes out Thursday"', hoursAgo: 6, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 41945, [
      { kind: 'review_commented', actor: 'remy', text: 'commented: "Would 3 hide fewer real flakes?"', hoursAgo: 1, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 41934, [
      { kind: 'team_mention', actor: 'ines', text: 'mentioned @team-devex: "do the runner labels clash?"', hoursAgo: 1.5, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41925, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'opened the PR', hoursAgo: 12, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 41857, [
      { kind: 'merged', actor: 'lyra', text: 'merged it', hoursAgo: 3, rule: 'quiet', seen: true },
      { kind: 'mention', actor: 'jude', text: 'mentioned you: "are the stale snapshots gone?"', hoursAgo: 2, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 41870, [
      { kind: 'review_requested', actor: 'sol', text: 'requested @team-devex', hoursAgo: 72, rule: 'loud' },
    ]),
  ];
}

function buildGlances(clock: SampleClock): Glance[] {
  return [
    sampleGlance(clock, 41902, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes Turbo cache keys, which you asked to hear about.',
      does: 'Points Turbo remote cache at Depot. First runs after merge are cold.',
      risk: 'Medium. Nothing breaks, CI slow for about an hour.',
      othersSaid: 'lyra approved. nell asked about warm-up, Rowan answered.',
    }),
    sampleGlance(clock, 41921, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Landing it apart from #41902 would make the cache go cold twice.',
      does: 'Minor Turbo bump.',
      risk: 'Low alone.',
      othersSaid: 'No human comments.',
    }),
    sampleGlance(clock, 41855, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Storybook now runs cold on every PR.',
      does: 'Sets cache: false on the storybook task.',
      risk: 'Slower CI, no breakage.',
      othersSaid: 'One approval, reason: stale snapshots.',
    }),
    sampleGlance(clock, 41911, {
      verdict: 'LOOKS_SAFE',
      forYou: 'You approved; since then Rowan raised the shard count and pinned the runner image.',
      does: 'Moves Playwright jobs to depot-ubuntu-24.04-8.',
      risk: 'Low. CI green.',
      othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 41915, {
      verdict: 'LOOK_CLOSER',
      forYou: 'You asked to hear about secrets. An org secret already exists.',
      does: 'Adds a repo secret and uses it in 3 workflows.',
      risk: 'Low now, messy later.',
      othersSaid: 'lyra approved.',
    }),
    sampleGlance(clock, 41899, {
      verdict: 'LOOKS_SAFE',
      forYou: 'You approved. Renames are fine per what you said.',
      does: 'Renames 9 workflow files.',
      risk: 'None.',
      othersSaid: '3 approvals.',
    }),
    sampleGlance(clock, 41790, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Loosens the 30 min limit you set. You asked to always hear about that.',
      does: 'Changes the timeout.',
      risk: 'Slow tests pass silently.',
      othersSaid: 'One approval.',
    }),
    sampleGlance(clock, 41822, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Nobody from devex looked. It changes what the flaky-test report reads.',
      does: 'Shards from timing JSON.',
      risk: 'Medium.',
      othersSaid: '2 approvals.',
    }),
    sampleGlance(clock, 41801, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Ada asked if it is reversible. It is state-only, so yes.',
      does: 'Moves 6 models.',
      risk: 'Low.',
      othersSaid: 'Ada asked for changes.',
    }),
    sampleGlance(clock, 41870, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes a hogli default, which you asked to see first.',
      does: 'Skips ClickHouse and Kafka by default.',
      risk: 'People lose services silently.',
      othersSaid: 'None yet.',
    }),
  ];
}

function buildTiles(): Tile[] {
  return [
    sampleTile(TOPIC.depot, 'set', 'set:turbo-cache', 'Three PRs change how Turbo caches', [
      pinged(41902, 'review_requested'),
      pinged(41921, 'review_requested'),
      pinged(41855, 'subscribed'),
    ]),
    sampleTile(TOPIC.depot, 'stack', `stack:${sampleKey(41851)}`, 'rowan/depot: e2e layer waits on you', [
      // Stack layers the sync pulled in by branch: no thread, no glance, no agent call.
      pulledIn(41851, 'stack layer below #41902'),
      pulledIn(41862, 'stack layer below #41902'),
      pinged(41902, 'review_requested'),
      pinged(41911, 'review_requested'),
    ]),
    sampleTile(TOPIC.depot, 'single', `pr:${sampleKey(41915)}`, 'DEPOT_TOKEN went in as a repo secret', [
      pinged(41915, 'team_mention'),
    ]),
    sampleTile(TOPIC.depot, 'single', `pr:${sampleKey(41899)}`, 'Rename workflow files to ci-*.yml', [
      pinged(41899, 'review_requested'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(41790)}`, 'Django test timeout raised to 45 min', [
      pinged(41790, 'subscribed'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(41822)}`, 'Timing-based shards, no devex review', [
      pinged(41822, 'review_requested'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(41945)}`, 'Your shard retry cap waits on lyra', [pinged(41945, 'author')]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(41801)}`, 'Ada asks if the error_tracking move is reversible', [
      pinged(41801, 'author'),
    ]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(41808)}`, 'Old error_tracking re-exports are approved', [pinged(41808, 'author')]),
    sampleTile(TOPIC.ingestion, 'single', `pr:${sampleKey(41934)}`, 'Ingestion asks devex about runner labels', [pinged(41934, 'team_mention')]),
    sampleTile(TOPIC.deps, 'single', `pr:${sampleKey(41925)}`, 'Bump ruff to 0.7', [pinged(41925, 'subscribed')]),
    sampleTile(TOPIC.frontend, 'single', `pr:${sampleKey(41857)}`, 'Vite 7 landed; jude asks about snapshots', [pinged(41857, 'mention')]),
    sampleTile(TOPIC.devEnv, 'single', `pr:${sampleKey(41870)}`, 'hogli start would default to minimal stack', [
      pinged(41870, 'review_requested'),
    ]),
    sampleTile(TOPIC.ingestion, 'single', `pr:${sampleKey(41930)}`, 'Ingestion asks devex about its runner workflow', [
      pinged(41930, 'review_requested'),
    ]),
    sampleTile(TOPIC.desktop, 'single', `pr:${sampleKey(41940)}`, 'Desktop 2.3 release thread', [pinged(41940, 'subscribed')]),
  ];
}

function buildSets(clock: SampleClock): PrSet[] {
  return [
    {
      id: 'turbo-cache',
      topicId: TOPIC.depot,
      title: 'Three PRs change how Turbo caches',
      take: 'All three touch the same Turbo cache keys; land them together.',
      members: [
        { prKey: sampleKey(41902), reason: 'Moves the Turbo remote cache to Depot.' },
        { prKey: sampleKey(41921), reason: '2.5 changes cache hashing.' },
        { prKey: sampleKey(41855), reason: 'Turns off the cache for Storybook.' },
      ],
      removedKeys: [],
      status: 'active',
      inputHash: 'sample',
      createdAt: clock.hoursAgo(3),
      updatedAt: clock.hoursAgo(3),
    },
  ];
}

function buildProposals(clock: SampleClock): TopicProposal[] {
  return [
    {
      id: 'proposal-rename-dev-env',
      kind: 'rename',
      topicId: TOPIC.devEnv,
      name: 'Dev env and hogli',
      intoTopicId: null,
      fromArea: null,
      prKeys: [],
      reason: 'Most recent PRs in this topic change hogli.',
      status: 'pending',
      createdAt: clock.hoursAgo(2),
      decidedAt: null,
    },
    // Filed by consolidation in the story of the sample.
    {
      id: 'proposal-merge-frontend',
      kind: 'merge',
      topicId: TOPIC.frontend,
      name: null,
      intoTopicId: TOPIC.depot,
      fromArea: null,
      prKeys: [],
      reason: 'Frontend build only shows up for the Turbo cache, and #41855 already sits in a Depot set.',
      status: 'pending',
      createdAt: clock.hoursAgo(2),
      decidedAt: null,
    },
  ];
}

function buildUserStates(clock: SampleClock): UserPrState[] {
  const approved = (number: number, hoursAgo: number): UserPrState => ({
    prKey: sampleKey(number),
    approvedAt: clock.hoursAgo(hoursAgo),
    approvedCommitOid: `sha${number}`,
    handledAt: null,
  });
  const approvedOlderHead: UserPrState = {
    prKey: sampleKey(41911),
    approvedAt: clock.hoursAgo(4),
    approvedCommitOid: 'sha41911-a',
    handledAt: null,
  };
  return [approved(41899, 24), approvedOlderHead];
}

function buildMembership(tiles: Tile[]): Map<PrKey, string> {
  const membership = new Map<PrKey, string>();
  for (const tile of tiles) {
    for (const member of tile.members) {
      if (!membership.has(member.prKey)) {
        membership.set(member.prKey, tile.topicId);
      }
    }
  }
  membership.set(sampleKey(41855), TOPIC.frontend);
  membership.set(sampleKey(41921), TOPIC.deps);
  return membership;
}

export function buildSampleData(now: Date): SampleData {
  const clock = new SampleClock(now);
  const tiles = buildTiles();
  return {
    viewer: SAMPLE_VIEWER,
    viewerTeams: ['PostHog/team-devex'],
    viewerTeamMembers: ['lyra', 'nell', 'rowan', 'sol'],
    topics: buildTopics(clock),
    prs: buildPrs(clock),
    events: buildEvents(clock),
    glances: buildGlances(clock),
    tiles,
    sets: buildSets(clock),
    proposals: buildProposals(clock),
    userStates: buildUserStates(clock),
    membership: buildMembership(tiles),
  };
}
