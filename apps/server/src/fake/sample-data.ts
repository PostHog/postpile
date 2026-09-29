// The "Move CI to Depot" sample from the design rounds, as domain objects.
// Used by FakeEngine so the server, CLI and desktop app run without GitHub or
// the agent.
import type { Glance, Pr, PrEvent, PrKey, PrSet, Tile, Topic, TopicProposal, UserPrState } from '@postpile/core';
import {
  found,
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
  warmer: 'topic-cache-warmer',
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
      summary: 'billing is waiting on one answer from you. Notifications moved and was fixed.',
      tailoring: 'Tell me when a migration touches real tables.',
      driver: SAMPLE_VIEWER,
      userRole: 'driver',
    }),
    sampleTopic(clock, {
      id: TOPIC.devEnv,
      area: 'Dev env',
      name: 'Dev env',
      summary: 'Mostly version bumps. One change to devbox defaults waits for a reviewer.',
      tailoring: 'Anything that changes devbox defaults goes to the top.',
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
      summary: 'Bot PRs that bump pinned versions.',
      tailoring: 'Never ping me for these.',
      driver: null,
      userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: TOPIC.ingestion,
      area: 'CI',
      name: 'Ingestion CI runners RFC',
      summary: 'Ingestion wants its own self-hosted runners and asks platform to review the workflow part.',
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
    // Every PR merged and quiet for 3 days: a sync retired it, so it only shows in the Finished drawer.
    {
      ...sampleTopic(clock, {
        id: TOPIC.warmer,
        area: 'CI',
        name: 'Drop the nightly cache warmer',
        summary: 'Depot keeps the cache warm, so the nightly warmer job is gone.',
        tailoring: '',
        driver: 'nell',
        userRole: 'reviewer',
      }),
      status: 'retired',
      updatedAt: clock.hoursAgo(48),
    },
  ];
}

function buildPrs(clock: SampleClock): Pr[] {
  return [
    samplePr(clock, {
      number: 1902, title: 'Use Depot cache backend for Turbo', author: 'rowan', state: 'OPEN',
      size: [186, 42, 7], checks: 'FAILURE', openedHoursAgo: 5,
      baseRef: 'rowan/depot-2', headRef: 'rowan/depot-3',
      body: `<!-- Thanks for the PR! Please fill in the sections below. -->

## Problem

Turbo's remote cache lives on GitHub's cache service, which evicts after 7 days and is slow from Depot runners.

## Changes

- Point \`TURBO_API\` at the Depot cache backend
- Add a **warm-up job** that primes the cache on the first run after merge
- Retry the warm-up once before failing

\`\`\`yaml
env:
  TURBO_API: https://cache.example.com
\`\`\`

| Job | Before | After |
| --- | --- | --- |
| backend | 14 min | 9 min |
| frontend | 11 min | 6 min |

![cache hit chart](https://example.com/cache-hits.png)

## How did you test this code?

- [x] Ran CI twice on my fork
- [ ] First run after merge (cold cache)

<!-- Don't forget to request a review from team-platform -->
See the [Depot cache docs](https://example.com/docs/cache) for the backend.`,
      files: [
        ['turbo.json', 12, 4],
        ['.github/workflows/ci-backend.yml', 48, 10],
        ['.github/workflows/ci-frontend.yml', 40, 12],
        ['.github/workflows/turbo-warm-up.yml', 62, 0],
        ['bin/turbo-cache-env.sh', 18, 0],
        ['docs/ci/caching.md', 4, 14],
        ['package.json', 2, 2],
      ],
      reviews: [
        ['lyra', 'APPROVED', 'Cache config looks right. The warm-up job is the only open point.'],
        ['nell', 'COMMENTED', 'The first run after merge took 38 min on my fork.'],
      ],
      reviewerUsers: [SAMPLE_VIEWER], reviewerTeams: ['acme/team-platform'],
      comments: [{ id: 'issuecomment-2', author: 'lyra', body: '@you does the warm-up job need a feature flag, or is one cold hour fine?\n\nMy worry is the first run after a lockfile change: the cache is empty, the warm-up job competes with the real jobs for runners, and the cold hour can stretch to two on a busy morning. A flag would let us turn it off per repo without a deploy. If a cold hour is fine, I would rather drop the warm-up job than keep dead config around. See https://example.com/acme/app/actions/runs/1234567890/attempts/2/very/long/path/that/should/wrap/instead/of/widening/the/pane for the run where it stalled.', hoursAgo: 0.3 }],
      threads: [
        {
          id: 'thread-1902-1',
          path: 'turbo.json',
          comments: [{ author: 'nell', body: 'Does the cache key include the runner image?', hoursAgo: 2 }],
        },
      ],
      commits: [
        { oid: 'a1b2c3', headline: 'Warm the Turbo cache on the first run', hoursAgo: 4 },
        { oid: 'sha1902', headline: 'Retry the warm-up once before failing', hoursAgo: 0.5 },
      ],
    }),
    // lyra's two-layer stack, inside the Turbo cache set: the stack mark shows in a set too.
    samplePr(clock, {
      number: 1904, title: 'Hash Turbo inputs by lockfile only', author: 'lyra', state: 'OPEN',
      size: [22, 9, 2], checks: 'SUCCESS', openedHoursAgo: 8,
      baseRef: 'master', headRef: 'lyra/turbo-keys-1', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 1907, title: 'Drop the per-job Turbo cache salt', author: 'lyra', state: 'OPEN',
      size: [6, 14, 2], checks: 'SUCCESS', openedHoursAgo: 7,
      baseRef: 'lyra/turbo-keys-1', headRef: 'lyra/turbo-keys-2', reviewerUsers: [SAMPLE_VIEWER],
      comments: [{ id: 'issuecomment-5', author: 'lyra', body: '@you ok to drop the salt now that keys come from the lockfile?', hoursAgo: 0.8 }],
    }),
    samplePr(clock, {
      number: 1921, title: 'Bump turbo to 2.5', author: 'renovate[bot]', state: 'OPEN',
      size: [4, 4, 2], checks: 'SUCCESS', openedHoursAgo: 3, reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 1855, title: 'Skip Turbo remote cache for Storybook', author: 'jude', state: 'MERGED',
      size: [3, 1, 1], checks: 'SUCCESS', openedHoursAgo: 30, mergedHoursAgo: 14, reviews: [['lyra', 'APPROVED']],
      comments: [{ id: 'issuecomment-3', author: 'jude', body: 'Are the snapshots stale because of the cache or because of the Vite upgrade?', hoursAgo: 16 }],
    }),
    samplePr(clock, {
      number: 1911, title: 'Run e2e on Depot runners', author: 'rowan', state: 'OPEN',
      size: [48, 48, 5], checks: 'SUCCESS', openedHoursAgo: 6,
      baseRef: 'rowan/depot-3', headRef: 'rowan/depot-4', reviewerUsers: ['nell'],
      reviews: [[SAMPLE_VIEWER, 'APPROVED', 'Labels match #1880.', 'sha1911-a']],
      commits: [
        { oid: 'sha1911-a', headline: 'Move Playwright jobs to Depot', hoursAgo: 5 },
        { oid: 'sha1911-b', headline: 'Bump Playwright shard count to 6', hoursAgo: 0.25 },
        { oid: 'sha1911', headline: 'Pin the Depot runner image', hoursAgo: 0.15 },
      ],
    }),
    samplePr(clock, {
      // Closed on top of the stack: it still shows there, greyed.
      number: 1930, title: 'Drop GitHub runners for release builds', author: 'rowan', state: 'CLOSED',
      size: [2, 30, 2], checks: 'SUCCESS', openedHoursAgo: 5,
      baseRef: 'rowan/depot-4', headRef: 'rowan/depot-5',
    }),
    samplePr(clock, {
      number: 1862, title: 'Backend jobs on Depot', author: 'rowan', state: 'MERGED',
      size: [60, 60, 6], checks: 'SUCCESS', openedHoursAgo: 96, mergedHoursAgo: 72,
      baseRef: 'rowan/depot-1', headRef: 'rowan/depot-2',
      reviews: [[SAMPLE_VIEWER, 'APPROVED'], ['lyra', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 1851, title: 'Add Depot project config', author: 'rowan', state: 'MERGED',
      size: [12, 0, 1], checks: 'SUCCESS', openedHoursAgo: 170, mergedHoursAgo: 144,
      baseRef: 'master', headRef: 'rowan/depot-1', reviews: [[SAMPLE_VIEWER, 'APPROVED']],
      comments: [{ id: 'issuecomment-1', author: 'nell', body: 'Can we keep GitHub runners for release builds until Depot has an SLA?', hoursAgo: 150 }],
    }),
    samplePr(clock, {
      number: 1915, title: 'DEPOT_TOKEN as repo secret', author: 'rowan', state: 'MERGED',
      size: [9, 3, 3], checks: 'SUCCESS', openedHoursAgo: 30, mergedHoursAgo: 24, reviews: [['lyra', 'APPROVED']],
      comments: [{ id: 'issuecomment-4', author: 'rowan', body: 'Keeping DEPOT_TOKEN a repo secret for now. The org secret move comes with the release workflow.', hoursAgo: 25 }],
    }),
    samplePr(clock, {
      number: 1899, title: 'Rename workflow files to ci-*.yml', author: 'rowan', state: 'OPEN',
      size: [0, 0, 9], checks: 'SUCCESS', openedHoursAgo: 48, queued: true,
      reviews: [[SAMPLE_VIEWER, 'APPROVED'], ['lyra', 'APPROVED'], ['nell', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 1840, title: 'Remove the nightly cache warmer job', author: 'nell', state: 'MERGED',
      size: [0, 64, 2], checks: 'SUCCESS', openedHoursAgo: 150, mergedHoursAgo: 120, reviews: [[SAMPLE_VIEWER, 'APPROVED']],
    }),
    samplePr(clock, {
      number: 1790, title: 'Raise Django test timeout to 45 min', author: 'nell', state: 'MERGED',
      size: [1, 1, 1], checks: 'SUCCESS', openedHoursAgo: 60, mergedHoursAgo: 48, reviews: [['rowan', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 1822, title: 'Split backend tests by timing data', author: 'remy', state: 'OPEN',
      size: [240, 80, 11], checks: 'SUCCESS', openedHoursAgo: 72,
      reviews: [['lyra', 'APPROVED'], ['sol', 'APPROVED']], reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 1801, title: 'Move billing models to modules/', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [410, 380, 24], checks: 'SUCCESS', openedHoursAgo: 48,
      body: 'Moves the six billing models into `modules/billing/`. State-only: `db_table` stays, so no table is renamed.\n\nFollow-up: drop the old re-exports in #1808.',
      files: [
        ['modules/billing/models.py', 320, 0],
        ['app/models/__init__.py', 6, 290],
        ['modules/billing/apps.py', 22, 0],
        ['app/migrations/0412_move_billing_models.py', 48, 0],
      ],
      reviews: [['ada', 'CHANGES_REQUESTED'], ['lyra', 'APPROVED']],
      threads: [
        {
          id: 'thread-1801-1',
          path: 'modules/billing/models.py',
          comments: [{ author: 'ada', body: 'Keep db_table so the move stays state-only?', hoursAgo: 26 }],
        },
        {
          id: 'thread-1801-2',
          path: 'app/models/__init__.py',
          comments: [{ author: 'ada', body: 'This re-export hides the new path.', hoursAgo: 26 }],
        },
        {
          id: 'thread-1801-3',
          path: 'modules/billing/apps.py',
          comments: [
            { author: 'lyra', body: 'Label clash with the old app?', hoursAgo: 30 },
            { author: SAMPLE_VIEWER, body: 'No, the label is new.', hoursAgo: 29 },
          ],
          resolved: true,
        },
      ],
    }),
    samplePr(clock, {
      number: 1932, title: 'RFC: self-hosted runners for ingestion CI', author: 'ines', state: 'OPEN',
      size: [140, 12, 3], checks: 'SUCCESS', openedHoursAgo: 20, reviewerTeams: ['acme/team-platform'],
      body: 'Ingestion jobs need more memory than Depot offers. This RFC adds a runner pool and one workflow change.',
    }),
    samplePr(clock, {
      number: 1940, title: 'Release desktop 2.3', author: 'mae', state: 'OPEN',
      size: [30, 10, 4], checks: 'PENDING', openedHoursAgo: 30, reviews: [['koa', 'APPROVED']],
    }),
    // Added for the sidebar's queue sections: your own PRs (My PRs), a team
    // mention (Team mentioned), a bot bump (Other topics) and a merged PR with
    // news on it (unread, but calm).
    samplePr(clock, {
      number: 1945, title: 'Cap CI shard retries at 2', author: SAMPLE_VIEWER, state: 'OPEN', draft: true,
      size: [14, 6, 2], checks: 'SUCCESS', openedHoursAgo: 8, reviewerUsers: ['lyra'],
      reviews: [['remy', 'COMMENTED', 'Would 3 hide fewer real flakes?']],
    }),
    samplePr(clock, {
      number: 1808, title: 'Drop the old billing re-exports', author: SAMPLE_VIEWER, state: 'OPEN',
      // Approved by an agent only: the pill reads "approved by agent", whose turn stays "Merge".
      size: [3, 40, 2], checks: 'SUCCESS', openedHoursAgo: 20, reviews: [['reviewbot[bot]', 'APPROVED']],
    }),
    samplePr(clock, {
      number: 1934, title: 'Ingestion runner pool as a Terraform module', author: 'ines', state: 'OPEN',
      size: [220, 0, 6], checks: 'SUCCESS', openedHoursAgo: 10,
      comments: [{ id: 'issuecomment-5', author: 'ines', body: '@acme/team-platform do the runner labels clash with yours?', hoursAgo: 1.5 }],
    }),
    samplePr(clock, {
      number: 1925, title: 'Bump ruff to 0.7', author: 'renovate[bot]', state: 'OPEN',
      size: [2, 2, 1], checks: 'SUCCESS', openedHoursAgo: 12,
    }),
    samplePr(clock, {
      number: 1857, title: 'Upgrade to Vite 7', author: 'lyra', state: 'MERGED',
      size: [120, 90, 14], checks: 'SUCCESS', openedHoursAgo: 50, mergedHoursAgo: 3, reviews: [['jude', 'APPROVED']],
      comments: [{ id: 'issuecomment-6', author: 'jude', body: '@you are the stale snapshots gone after this?', hoursAgo: 2 }],
    }),
    samplePr(clock, {
      number: 1870, title: 'Make devbox start default to minimal stack', author: 'sol', state: 'OPEN',
      size: [70, 12, 4], checks: 'SUCCESS', openedHoursAgo: 72, reviewerTeams: ['acme/team-platform'],
    }),
    // Found outside the inbox: the viewer's own open PR, and a review asked of them they already read on GitHub.
    samplePr(clock, {
      number: 1950, title: 'Cache pnpm store in the devbox CI image', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [34, 8, 2], checks: 'PENDING', openedHoursAgo: 30,
    }),
    // Addressed your changes, seen on a revisit: you asked for changes
    // yesterday, pim pushed three commits (a review bot and CI chimed in) and
    // never re-requested a review. Back to you; the strip says
    // "3 commits since your changes request".
    samplePr(clock, {
      number: 1960, title: 'Split the toolbar into its own bundle', author: 'pim', state: 'OPEN',
      size: [260, 90, 9], checks: 'SUCCESS', openedHoursAgo: 50,
      reviews: [[SAMPLE_VIEWER, 'CHANGES_REQUESTED', 'The chunk names change on every build, which busts the CDN cache.', 'sha1960-a', 30]],
      threads: [
        {
          id: 'thread-1960-1',
          path: 'frontend/vite.config.ts',
          comments: [{ author: SAMPLE_VIEWER, body: 'Can these chunk names be stable?', hoursAgo: 30 }],
        },
      ],
      commits: [
        { oid: 'sha1960-a', headline: 'Split the toolbar bundle', hoursAgo: 48 },
        { oid: 'sha1960-b', headline: 'Hash chunk names from the entry path', hoursAgo: 3 },
        { oid: 'sha1960-c', headline: 'Keep the vendor chunk name fixed', hoursAgo: 2.6 },
        { oid: 'sha1960', headline: 'Stable chunk names for the toolbar', hoursAgo: 2.2 },
      ],
    }),
    // Changes you requested, still waiting on the author: you asked tove for
    // changes yesterday and nothing moved since. Listed under Changes you
    // requested after the addressed #1960, quiet.
    samplePr(clock, {
      number: 1963, title: 'Inline small SVG icons into the bundle', author: 'tove', state: 'OPEN',
      size: [80, 30, 5], checks: 'SUCCESS', openedHoursAgo: 40,
      reviews: [[SAMPLE_VIEWER, 'CHANGES_REQUESTED', 'Inlining drops the long cache on the icon sprite.', 'sha1963', 20]],
      threads: [
        {
          id: 'thread-1963-1',
          path: 'frontend/icons/index.ts',
          comments: [{ author: SAMPLE_VIEWER, body: 'Keep the sprite for icons over 1 kB?', hoursAgo: 20 }],
        },
      ],
      commits: [{ oid: 'sha1963', headline: 'Inline icons under 4 kB', hoursAgo: 38 }],
    }),
    samplePr(clock, {
      number: 1955, title: 'Pin the Playwright browser version', author: 'nell', state: 'OPEN',
      size: [12, 4, 2], checks: 'SUCCESS', openedHoursAgo: 26, reviewerUsers: [SAMPLE_VIEWER],
    }),
  ];
}

function buildEvents(clock: SampleClock): PrEvent[] {
  return [
    ...sampleEvents(clock, 1902, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 5, rule: 'loud', seen: true },
      { kind: 'deploy', actor: 'deploy-bot', text: 'deployed a preview', hoursAgo: 1, rule: 'quiet', isBot: true },
      { kind: 'mention', actor: 'lyra', text: 'mentioned you: does the warm-up job need a feature flag, or is one cold hour fine?', sourceId: 'issuecomment-2', hoursAgo: 0.3, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1904, [
      { kind: 'review_requested', actor: 'lyra', text: 'requested a review from you', hoursAgo: 8, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 1907, [
      { kind: 'review_requested', actor: 'lyra', text: 'requested a review from you', hoursAgo: 7, rule: 'loud', seen: true },
      { kind: 'mention', actor: 'lyra', text: 'mentioned you: "ok to drop the salt?"', hoursAgo: 0.8, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1921, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'opened the PR', hoursAgo: 3, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1855, [
      { kind: 'merged', actor: 'jude', text: 'merged it', hoursAgo: 14, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1911, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 6, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 4, rule: 'quiet', seen: true },
      { kind: 'commits_after_approval', actor: 'rowan', text: 'pushed "Bump Playwright shard count to 6" after your approval', hoursAgo: 0.25, rule: 'quiet' },
      {
        kind: 'commits_after_approval',
        actor: 'rowan',
        text: 'pushed "Pin the Depot runner image" after your approval',
        hoursAgo: 0.15,
        rule: 'quiet',
        raisedBecause: 'Changes the CI runner image you approved, not a plain follow-up.',
      },
      { kind: 'ci', actor: 'ci-bot', text: 'all checks passed', hoursAgo: 0.1, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1862, [
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 72, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1851, [
      { kind: 'merged', actor: 'rowan', text: 'merged it', hoursAgo: 144, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1915, [
      { kind: 'team_mention', actor: 'rowan', text: 'mentioned @team-platform', hoursAgo: 24, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1899, [
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 24, rule: 'quiet', seen: true },
      {
        kind: 'force_pushed', actor: 'renovate[bot]', text: 'rebased', hoursAgo: 3, rule: 'quiet', isBot: true,
        mutedBecause: 'Bot rebase, no content change.',
      },
      { kind: 'merge_queue', actor: 'mergify[bot]', text: 'queued for merge', hoursAgo: 1, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1840, [
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 150, rule: 'loud', seen: true },
      { kind: 'merged', actor: 'nell', text: 'merged it', hoursAgo: 120, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1790, [
      { kind: 'merged_without_review', actor: 'nell', text: 'merged it without your review', hoursAgo: 48, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 1822, [
      { kind: 'review_requested', actor: 'remy', text: 'requested @team-platform', hoursAgo: 72, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1801, [
      { kind: 'question_to_user', actor: 'ada', text: 'asked "is this reversible?"', hoursAgo: 24, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1932, [
      { kind: 'review_requested', actor: 'ines', text: 'requested @team-platform', hoursAgo: 2, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1940, [
      { kind: 'comment', actor: 'mae', text: 'commented: "2.3 goes out Thursday"', hoursAgo: 6, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 1945, [
      { kind: 'review_commented', actor: 'remy', text: 'commented: "Would 3 hide fewer real flakes?"', hoursAgo: 1, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1934, [
      { kind: 'team_mention', actor: 'ines', text: 'mentioned @team-platform: "do the runner labels clash?"', hoursAgo: 1.5, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1925, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'opened the PR', hoursAgo: 12, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1857, [
      { kind: 'merged', actor: 'lyra', text: 'merged it', hoursAgo: 3, rule: 'quiet', seen: true },
      { kind: 'mention', actor: 'jude', text: 'mentioned you: "are the stale snapshots gone?"', hoursAgo: 2, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1870, [
      { kind: 'review_requested', actor: 'sol', text: 'requested @team-platform', hoursAgo: 72, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1960, [
      { kind: 'review_changes_requested', actor: SAMPLE_VIEWER, text: 'requested changes', hoursAgo: 30, rule: 'quiet', seen: true },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Hash chunk names from the entry path', hoursAgo: 3, rule: 'loud' },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Keep the vendor chunk name fixed', hoursAgo: 2.6, rule: 'loud' },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Stable chunk names for the toolbar', hoursAgo: 2.2, rule: 'loud' },
      { kind: 'bot_comment', actor: 'reviewbot[bot]', text: 'commented: "No issues found in 9 files"', hoursAgo: 2.1, rule: 'quiet', isBot: true },
      { kind: 'bot_comment', actor: 'sizebot[bot]', text: 'commented: "toolbar.js -18 kB"', hoursAgo: 2, rule: 'quiet', isBot: true },
      { kind: 'ci', actor: 'ci-bot', text: 'all checks passed', hoursAgo: 1.9, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1963, [
      { kind: 'review_changes_requested', actor: SAMPLE_VIEWER, text: 'requested changes', hoursAgo: 20, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1955, [
      // Loud, but the PR is only found (no notification): the tile stays calm, whose turn says your move.
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 26, rule: 'loud' },
    ]),
  ];
}

function buildGlances(clock: SampleClock): Glance[] {
  return [
    sampleGlance(clock, 1902, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes Turbo cache keys, which you asked to hear about.',
      does: 'Points Turbo remote cache at Depot. First runs after merge are cold.',
      risk: 'Medium. Nothing breaks, CI slow for about an hour.',
      othersSaid: 'lyra approved. nell asked about warm-up, Rowan answered.',
      keyFiles: [
        { path: 'turbo.json', why: 'Cache keys change; check the runner image is in them.' },
        { path: '.github/workflows/turbo-warm-up.yml', why: 'New job with DEPOT_TOKEN and a retry.' },
        { path: 'bin/turbo-cache-env.sh', why: 'Sets TURBO_API for every job.' },
      ],
    }),
    sampleGlance(clock, 1904, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Changes Turbo cache keys, which you asked to hear about.',
      does: 'Hashes task inputs by the lockfile instead of every package.json.',
      risk: 'Low. One cold run after merge.',
      othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 1907, {
      verdict: 'LOOK_CLOSER',
      forYou: 'lyra asks you whether the salt can go.',
      does: 'Removes the per-job salt from Turbo cache keys, built on #1904.',
      risk: 'Medium. Jobs could share cache entries they should not.',
      othersSaid: 'lyra asked you directly.',
    }),
    sampleGlance(clock, 1921, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Landing it apart from #1904 would make the cache go cold twice.',
      does: 'Minor Turbo bump.',
      risk: 'Low alone.',
      othersSaid: 'No human comments.',
    }),
    sampleGlance(clock, 1855, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Storybook now runs cold on every PR.',
      does: 'Sets cache: false on the storybook task.',
      risk: 'Slower CI, no breakage.',
      othersSaid: 'One approval, reason: stale snapshots.',
    }),
    sampleGlance(clock, 1911, {
      verdict: 'LOOKS_SAFE',
      forYou: 'You approved; since then Rowan raised the shard count and pinned the runner image.',
      does: 'Moves Playwright jobs to depot-ubuntu-24.04-8.',
      risk: 'Low. Same jobs, bigger runners.',
      othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 1915, {
      verdict: 'LOOK_CLOSER',
      forYou: 'You asked to hear about secrets. An org secret already exists.',
      does: 'Adds a repo secret and uses it in 3 workflows.',
      risk: 'Low now, messy later.',
      othersSaid: 'lyra approved.',
    }),
    sampleGlance(clock, 1899, {
      verdict: 'LOOKS_SAFE',
      forYou: 'You approved. Renames are fine per what you said.',
      does: 'Renames 9 workflow files.',
      risk: 'None.',
      othersSaid: '3 approvals.',
    }),
    sampleGlance(clock, 1790, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Loosens the 30 min limit you set. You asked to always hear about that.',
      does: 'Changes the timeout.',
      risk: 'Slow tests pass silently.',
      othersSaid: 'One approval.',
    }),
    sampleGlance(clock, 1822, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Nobody from platform looked. It changes what the flaky-test report reads.',
      does: 'Shards from timing JSON.',
      risk: 'Medium.',
      othersSaid: '2 approvals.',
    }),
    sampleGlance(clock, 1801, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Ada asked if it is reversible. It is state-only, so yes.',
      does: 'Moves 6 models.',
      risk: 'Low.',
      othersSaid: 'Ada asked for changes.',
      keyFiles: [
        { path: 'app/migrations/0412_move_billing_models.py', why: 'Must be state-only: SeparateDatabaseAndState, no table rename.' },
        { path: 'app/models/__init__.py', why: 'The re-export Ada flagged.' },
      ],
    }),
    sampleGlance(clock, 1870, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes a devbox default, which you asked to see first.',
      does: 'Skips ClickHouse and Kafka by default.',
      risk: 'People lose services silently.',
      othersSaid: 'None yet.',
    }),
  ];
}

function buildTiles(): Tile[] {
  return [
    // #1902 sits only in the Depot stack below (one unit per PR); lyra's stack joins the set whole.
    sampleTile(
      TOPIC.depot,
      'set',
      'set:turbo-cache',
      'Four PRs change how Turbo caches',
      [pinged(1904, 'review_requested'), pinged(1907, 'mention'), pinged(1921, 'review_requested'), pinged(1855, 'subscribed')],
      [[1904, 1907]],
    ),
    sampleTile(TOPIC.depot, 'stack', `stack:${sampleKey(1851)}`, 'rowan/depot: e2e layer waits on you', [
      // Stack layers the sync pulled in by branch: no thread, no glance, no agent call.
      pulledIn(1851, 'stack layer below #1902'),
      pulledIn(1862, 'stack layer below #1902'),
      pinged(1902, 'review_requested'),
      pinged(1911, 'review_requested'),
      pulledIn(1930, 'stack layer above #1911'),
    ]),
    sampleTile(TOPIC.depot, 'single', `pr:${sampleKey(1915)}`, 'DEPOT_TOKEN went in as a repo secret', [
      pinged(1915, 'team_mention'),
    ]),
    sampleTile(TOPIC.depot, 'single', `pr:${sampleKey(1899)}`, 'Rename workflow files to ci-*.yml', [
      pinged(1899, 'review_requested'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1790)}`, 'Django test timeout raised to 45 min', [
      pinged(1790, 'subscribed'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1822)}`, 'Timing-based shards, no platform review', [
      pinged(1822, 'review_requested'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1945)}`, 'Your shard retry cap waits on lyra', [pinged(1945, 'author')]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(1801)}`, 'Ada asks if the billing move is reversible', [
      pinged(1801, 'author'),
    ]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(1808)}`, 'Old billing re-exports are approved', [pinged(1808, 'author')]),
    sampleTile(TOPIC.ingestion, 'single', `pr:${sampleKey(1934)}`, 'Ingestion asks platform about runner labels', [pinged(1934, 'team_mention')]),
    sampleTile(TOPIC.deps, 'single', `pr:${sampleKey(1925)}`, 'Bump ruff to 0.7', [pinged(1925, 'subscribed')]),
    sampleTile(TOPIC.frontend, 'single', `pr:${sampleKey(1857)}`, 'Vite 7 landed; jude asks about snapshots', [pinged(1857, 'mention')]),
    sampleTile(TOPIC.devEnv, 'single', `pr:${sampleKey(1960)}`, 'pim addressed your toolbar bundle changes', [
      pinged(1960, 'comment'),
    ]),
    sampleTile(TOPIC.frontend, 'single', `pr:${sampleKey(1963)}`, 'Your icon sprite changes wait on tove', [
      pinged(1963, 'comment'),
    ]),
    sampleTile(TOPIC.devEnv, 'single', `pr:${sampleKey(1870)}`, 'devbox start would default to minimal stack', [
      pinged(1870, 'review_requested'),
    ]),
    sampleTile(TOPIC.ingestion, 'single', `pr:${sampleKey(1932)}`, 'Ingestion asks platform about its runner workflow', [
      pinged(1932, 'review_requested'),
    ]),
    sampleTile(TOPIC.warmer, 'single', `pr:${sampleKey(1840)}`, 'Nightly cache warmer removed', [pinged(1840, 'review_requested')]),
    sampleTile(TOPIC.desktop, 'single', `pr:${sampleKey(1940)}`, 'Desktop 2.3 release thread', [pinged(1940, 'subscribed')]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1950)}`, 'Your pnpm cache PR for the devbox image', [found(1950, 'own_open', 'your open PR')]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1955)}`, 'nell wants your review on the Playwright pin', [
      found(1955, 'review_requested', 'review requested from you'),
    ]),
  ];
}

function buildSets(clock: SampleClock): PrSet[] {
  return [
    {
      id: 'turbo-cache',
      topicId: TOPIC.depot,
      title: 'Four PRs change how Turbo caches',
      take: 'All four touch the same Turbo cache keys; land them together.',
      members: [
        { prKey: sampleKey(1904), reason: 'Hashes Turbo inputs by the lockfile.' },
        { prKey: sampleKey(1907), reason: 'Drops the per-job cache salt.' },
        { prKey: sampleKey(1921), reason: '2.5 changes cache hashing.' },
        { prKey: sampleKey(1855), reason: 'Turns off the cache for Storybook.' },
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
      name: 'Dev env and devbox',
      intoTopicId: null,
      fromArea: null,
      prKeys: [],
      reason: 'Most recent PRs in this topic change devbox.',
      status: 'pending',
      createdAt: clock.hoursAgo(2),
      decidedAt: null,
      source: 'consolidation',
      client: null,
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
      reason: 'Frontend build only shows up for the Turbo cache, and #1855 already sits in a Depot set.',
      status: 'pending',
      createdAt: clock.hoursAgo(2),
      decidedAt: null,
      source: 'consolidation',
      client: null,
    },
    // Suggested by an outside agent (Claude Code in a checkout) through the MCP server.
    {
      id: 'proposal-split-sharding',
      kind: 'split',
      topicId: TOPIC.ci,
      name: 'Backend test sharding',
      intoTopicId: null,
      fromArea: null,
      prKeys: [sampleKey(1822), sampleKey(1945)],
      reason: 'Both PRs change how backend tests are sharded; the rest of the topic is timeouts and browsers.',
      status: 'pending',
      createdAt: clock.hoursAgo(1),
      decidedAt: null,
      source: 'agent',
      client: 'claude-code',
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
    prKey: sampleKey(1911),
    approvedAt: clock.hoursAgo(4),
    approvedCommitOid: 'sha1911-a',
    handledAt: null,
  };
  return [approved(1899, 24), approvedOlderHead];
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
  membership.set(sampleKey(1855), TOPIC.frontend);
  membership.set(sampleKey(1921), TOPIC.deps);
  return membership;
}

export function buildSampleData(now: Date): SampleData {
  const clock = new SampleClock(now);
  const tiles = buildTiles();
  return {
    viewer: SAMPLE_VIEWER,
    viewerTeams: ['acme/team-platform'],
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
