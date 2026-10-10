// The "Move CI to Depot" sample from the design rounds, as domain objects.
// Used by FakeEngine so the server, CLI and desktop app run without GitHub or
// the agent.
import type { FullPr, Glance, PrEdits, PrEvent, PrKey, PrSet, Snooze, Tile, Topic, TopicProposal, UserPrState } from '@postpile/core';
import { addFakeExtras, type FakeExtra } from './fake-extras.ts';
import {
  found,
  pinged,
  pulledIn,
  SAMPLE_AGENT,
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
  /** The viewer's teams, as GitHub names them ("org/slug"), home and routing. */
  viewerTeams: string[];
  /** Their home teams (DESIGN.md "Team roles"); the others only route reviews to them. */
  viewerHomeTeams: string[];
  /** Everyone else on the home teams, like the engine's daily team-member fetch. */
  viewerTeamMembers: string[];
  topics: Topic[];
  prs: FullPr[];
  events: PrEvent[];
  glances: Glance[];
  tiles: Tile[];
  sets: PrSet[];
  proposals: TopicProposal[];
  userStates: UserPrState[];
  /** PR -> topic. PRs pulled into another topic's tile keep their own topic. */
  membership: Map<PrKey, string>;
  /** CODEOWNERS text per repo, like the engine's daily read; a repo missing here has none. */
  codeOwners: Map<string, string>;
  /** Changed line ranges per PR, like the sync's diff read. None in the default sample, so nothing overlaps. */
  prEdits: PrEdits[];
  /** Snoozes the sample starts with (a pack's); the default sample has none. */
  snoozes?: Snooze[];
}

/** acme/app's CODEOWNERS: the workflows and build scripts are the viewer's team's, the rest is someone else's. */
const SAMPLE_CODEOWNERS = [
  '# Sample CODEOWNERS (fake mode)',
  '*                   @acme/team-core',
  '/.github/           @acme/team-platform',
  '/bin/               @acme/team-platform',
  '/turbo.json         @acme/team-platform',
  '/docs/              @acme/docs',
  '/modules/billing/   @acme/team-billing',
].join('\n');

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
  sdk: 'topic-sdk-uploads',
  runners: 'topic-runner-images',
  quarantine: 'topic-flaky-quarantine',
  egress: 'topic-egress-allowlist',
  replayStorage: 'topic-replay-storage',
  replayPlayer: 'topic-replay-player',
  usageExports: 'topic-usage-exports',
  alertPresets: 'topic-alert-presets',
  docsSearch: 'topic-docs-search',
  statusBadge: 'topic-status-badge',
};

// Trunk's status comment as trunk-io[bot] edits it (DESIGN.md "Merge queue"): an en space after the emoji.
/** A review bot that opens inline threads (as greptile does); people answer it there. */
const GREPTILE = 'greptile-apps[bot]';

const TRUNK_TESTING =
  '<!-- Trunk Merge -->\n🧪\u2002Running tests on this pull request (testing on PR [#1976](https://github.com/acme/app/pull/1976)) - [details](https://app.trunk.io/acme/merge/1975).';
const TRUNK_SUBMITTED =
  '<!-- Trunk Merge -->\n✨\u2002Submitted to Merge by You Example (@you). It will be added to the merge queue once all branch protection rules pass. See more details [here](https://app.trunk.io/acme/merge/1977).';
const TRUNK_WAITING = '<!-- Trunk Merge -->\n⏳\u2002Waiting to start tests on this pull request - [details](https://app.trunk.io/acme/merge/1978)';
const TRUNK_MERGED = '<!-- Trunk Merge -->\n😎\u2002Merged successfully - [details](https://app.trunk.io/acme/merge/1974).';
const TRUNK_REMOVED =
  "<!-- Trunk Merge -->\n🚫\u2002This pull request was removed from the merge queue because it was waiting to become mergeable for too long (for example: missing required approvals or checks, or a merge conflict). Submit it again once it's ready to merge. See more details [here](https://app.trunk.io/acme/merge/1950).";

function buildTopics(clock: SampleClock): Topic[] {
  return [
    sampleTopic(clock, {
      id: TOPIC.depot,
      area: 'CI',
      name: 'Move CI to Depot',
      summary: 'Backend and frontend run on Depot. Turbo caching and e2e are in flight. Release builds stay on GitHub runners: #1930 was closed.',
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
      area: 'Database',
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
      area: 'Dependencies',
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
    // Reaches the viewer only through client-approvers, a team that routes reviews to them (not their team).
    sampleTopic(clock, {
      id: TOPIC.sdk,
      area: 'SDK',
      name: 'Python SDK upload retries',
      summary: 'The client team reworks how the Python SDK retries uploads. client-approvers is asked to sign off.',
      tailoring: '',
      driver: 'koa',
      userRole: 'reviewer',
    }),
    // The viewer's one PR here is testing in the Trunk merge queue: the queue icon, amber.
    sampleTopic(clock, {
      id: TOPIC.runners,
      area: 'CI',
      name: 'Runner image pinning',
      summary: 'Pinning the Depot runner images by digest, one PR per image. Linux merged through the merge queue; the rest are in it.',
      tailoring: '',
      driver: SAMPLE_VIEWER,
      userRole: 'driver',
    }),
    // The ownership sections (DESIGN.md "Ownership sections"): sol, a teammate, drives it and you have a PR in it, so Your team owns.
    sampleTopic(clock, {
      id: TOPIC.quarantine,
      area: 'CI',
      name: 'Flaky test quarantine',
      summary: 'sol moves known flaky tests into a quarantine job that never blocks a merge. Your PR adds the retry report.',
      tailoring: '',
      driver: 'sol',
      userRole: 'stakeholder',
    }),
    // A standing topic of your team with no single driver: the owner team places it under Your team owns.
    sampleTopic(clock, {
      id: TOPIC.egress,
      area: 'Networking',
      name: 'Egress allowlist',
      summary: 'Outbound hosts the CI runners may reach. Changes come in one at a time.',
      tailoring: '',
      driver: null,
      userRole: 'watcher',
      kind: 'standing',
    }),
    // Other work: driven outside your team. Two Replay topics share an area fold; the rest gather under More.
    sampleTopic(clock, {
      id: TOPIC.replayStorage,
      area: 'Replay',
      name: 'Replay storage tiering',
      summary: 'pia moves recordings older than 30 days to cold storage. A question about CI disk space came up.',
      tailoring: '',
      driver: 'pia',
      userRole: 'watcher',
    }),
    sampleTopic(clock, {
      id: TOPIC.replayPlayer,
      area: 'Replay',
      name: 'Replay player memory',
      summary: 'gus trims the player buffer so long recordings stop crashing the tab.',
      tailoring: '',
      driver: 'pia',
      userRole: 'watcher',
    }),
    // omar drives it; the owner signal says your team only because you wrote a PR here, so it stays Other work.
    sampleTopic(clock, {
      id: TOPIC.usageExports,
      area: 'Billing',
      name: 'Usage report exports',
      summary: 'omar adds CSV exports for usage reports. Your PR moves the export job onto the shared runners.',
      tailoring: '',
      driver: 'omar',
      userRole: 'stakeholder',
    }),
    sampleTopic(clock, {
      id: TOPIC.alertPresets,
      area: 'Alerting',
      name: 'Alert threshold presets',
      summary: 'gus adds presets for common alert thresholds.',
      tailoring: '',
      driver: 'gus',
      userRole: 'watcher',
    }),
    // No dossier and no driver yet: Other topics, "not sorted yet".
    sampleTopic(clock, {
      id: TOPIC.docsSearch,
      area: null,
      name: 'Docs search index',
      summary: '',
      tailoring: '',
      driver: null,
      userRole: 'watcher',
    }),
    // Its only news is a merge: opening it marks the merge read after the
    // dwell and the topic settles into "Everything here is dealt with".
    sampleTopic(clock, {
      id: TOPIC.statusBadge,
      area: null,
      name: 'Status page badge',
      summary: '',
      tailoring: '',
      driver: null,
      userRole: 'watcher',
    }),
    // Every PR merged and quiet for 2 days: a sync moved it to the Archive drawer.
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
      retiredAt: clock.hoursAgo(48),
      updatedAt: clock.hoursAgo(48),
    },
  ];
}

function buildPrs(clock: SampleClock): FullPr[] {
  return [
    samplePr(clock, {
      number: 1902, title: 'Use Depot cache backend for Turbo', author: 'rowan', state: 'OPEN',
      size: [186, 42, 7], openedHoursAgo: 5,
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
        ['lyra', 'APPROVED', 'Cache config looks right. The warm-up job is the only open point.', undefined, 0.45],
        ['nell', 'COMMENTED', 'The first run after merge took 38 min on my fork.', undefined, 2],
      ],
      reviewerUsers: [SAMPLE_VIEWER], reviewerTeams: ['acme/team-platform'],
      comments: [{ id: 'issuecomment-2', author: 'lyra', body: '@you does the warm-up job need a feature flag, or is one cold hour fine?\n\nMy worry is the first run after a lockfile change: the cache is empty, the warm-up job competes with the real jobs for runners, and the cold hour can stretch to two on a busy morning. A flag would let us turn it off per repo without a deploy. If a cold hour is fine, I would rather drop the warm-up job than keep dead config around. See https://example.com/acme/app/actions/runs/1234567890/attempts/2/very/long/path/that/should/wrap/instead/of/widening/the/pane for the run where it stalled.', hoursAgo: 0.3 }],
      threads: [
        {
          id: 'thread-1902-1',
          path: 'turbo.json',
          // nell asks, the author answers in the thread: the detail pane's reply and thumbs up have a conversation to show.
          comments: [
            { author: 'nell', body: 'Does the cache key include the runner image?', hoursAgo: 2 },
            { author: 'rowan', body: 'Not yet. The image tag goes in with the next layer, so arm and x86 runs stop sharing entries.', hoursAgo: 1.5 },
          ],
        },
      ],
      commits: [
        { oid: 'a1b2c3', headline: 'Warm the Turbo cache on the first run', hoursAgo: 4 },
        { oid: 'sha1902', headline: 'Retry the warm-up once before failing', hoursAgo: 0.5 },
      ],
    }),
    // lyra's two-layer stack, inside the Turbo cache set: the stack mark shows in a set too.
    // Declared in the body: #1907 is based on master and says "Stacked on #1904".
    samplePr(clock, {
      number: 1904, title: 'Hash Turbo inputs by lockfile only', author: 'lyra', state: 'OPEN',
      size: [22, 9, 2], openedHoursAgo: 8,
      baseRef: 'master', headRef: 'lyra/turbo-keys-1', reviewerUsers: [SAMPLE_VIEWER],
    }),
    samplePr(clock, {
      number: 1907, title: 'Drop the per-job Turbo cache salt', author: 'lyra', state: 'OPEN',
      size: [6, 14, 2], openedHoursAgo: 7,
      baseRef: 'master', headRef: 'lyra/turbo-keys-2', reviewerUsers: [SAMPLE_VIEWER],
      body: 'Stacked on #1904; the GitHub diff includes its changes. Drops the salt now that keys come from the lockfile.',
      comments: [{ id: 'issuecomment-5', author: 'lyra', body: '@you ok to drop the salt now that keys come from the lockfile?', hoursAgo: 0.8 }],
    }),
    samplePr(clock, {
      number: 1921, title: 'Bump turbo to 2.5', author: 'renovate[bot]', state: 'OPEN',
      size: [4, 4, 2], openedHoursAgo: 3, reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 1855, title: 'Skip Turbo remote cache for Storybook', author: 'jude', state: 'MERGED',
      size: [3, 1, 1], openedHoursAgo: 30, mergedHoursAgo: 14, reviews: [['lyra', 'APPROVED', '', undefined, 15]],
      comments: [{ id: 'issuecomment-3', author: 'jude', body: 'Are the snapshots stale because of the cache or because of the Vite upgrade?', hoursAgo: 16 }],
    }),
    samplePr(clock, {
      number: 1911, title: 'Run e2e on Depot runners', author: 'rowan', state: 'OPEN',
      size: [48, 48, 5], openedHoursAgo: 6,
      baseRef: 'rowan/depot-3', headRef: 'rowan/depot-4', reviewerUsers: ['nell'],
      // Says "depends on" the layer it sits on by branch: still a stack, no merge-order line.
      body: 'Depends on #1902 for the cache backend.',
      reviews: [[SAMPLE_VIEWER, 'APPROVED', 'Labels match #1880.', 'sha1911-a', 4]],
      commits: [
        { oid: 'sha1911-a', headline: 'Move Playwright jobs to Depot', hoursAgo: 5 },
        { oid: 'sha1911-b', headline: 'Bump Playwright shard count to 6', hoursAgo: 0.25 },
        { oid: 'sha1911', headline: 'Pin the Depot runner image', hoursAgo: 0.15 },
      ],
    }),
    samplePr(clock, {
      // Closed on top of the stack: it still shows there, greyed.
      number: 1930, title: 'Drop GitHub runners for release builds', author: 'rowan', state: 'CLOSED',
      size: [2, 30, 2], openedHoursAgo: 5,
      baseRef: 'rowan/depot-4', headRef: 'rowan/depot-5',
    }),
    samplePr(clock, {
      number: 1862, title: 'Backend jobs on Depot', author: 'rowan', state: 'MERGED',
      size: [60, 60, 6], openedHoursAgo: 96, mergedHoursAgo: 72,
      baseRef: 'rowan/depot-1', headRef: 'rowan/depot-2',
      reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 75], ['lyra', 'APPROVED', '', undefined, 74]],
    }),
    samplePr(clock, {
      number: 1851, title: 'Add Depot project config', author: 'rowan', state: 'MERGED',
      size: [12, 0, 1], openedHoursAgo: 170, mergedHoursAgo: 144,
      baseRef: 'master', headRef: 'rowan/depot-1', reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 146]],
      comments: [{ id: 'issuecomment-1', author: 'nell', body: 'Can we keep GitHub runners for release builds until Depot has an SLA?', hoursAgo: 150 }],
    }),
    samplePr(clock, {
      number: 1915, title: 'DEPOT_TOKEN as repo secret', author: 'rowan', state: 'MERGED',
      size: [9, 3, 3], openedHoursAgo: 30, mergedHoursAgo: 24, reviews: [['lyra', 'APPROVED', '', undefined, 26]],
      comments: [{ id: 'issuecomment-4', author: 'rowan', body: '@acme/team-platform keeping DEPOT_TOKEN a repo secret for now.\n\nThe org secret move comes with the release workflow.', hoursAgo: 25 }],
    }),
    samplePr(clock, {
      number: 1899, title: 'Rename workflow files to ci-*.yml', author: 'rowan', state: 'OPEN',
      size: [27, 27, 9], openedHoursAgo: 48, queued: true,
      // A merge order, not a stack: pr_context shows "Depends on acme/app#1915 (merge after)".
      body: 'Depends on #1915: the renamed workflows read DEPOT_TOKEN.',
      reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 24], ['lyra', 'APPROVED', '', undefined, 20], ['nell', 'APPROVED', '', undefined, 10]],
    }),
    samplePr(clock, {
      number: 1840, title: 'Remove the nightly cache warmer job', author: 'nell', state: 'MERGED',
      size: [0, 64, 2], openedHoursAgo: 150, mergedHoursAgo: 120, reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 122]],
    }),
    samplePr(clock, {
      number: 1790, title: 'Raise Django test timeout to 45 min', author: 'nell', state: 'MERGED',
      size: [1, 1, 1], openedHoursAgo: 60, mergedHoursAgo: 48, reviews: [['rowan', 'APPROVED', '', undefined, 50]],
    }),
    samplePr(clock, {
      number: 1822, title: 'Split backend tests by timing data', author: 'remy', state: 'OPEN',
      size: [240, 80, 11], openedHoursAgo: 72,
      reviews: [['lyra', 'APPROVED', '', undefined, 30], ['sol', 'APPROVED', '', undefined, 26]], reviewerTeams: ['acme/team-platform'],
    }),
    samplePr(clock, {
      number: 1801, title: 'Move billing models to modules/', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [410, 380, 24], openedHoursAgo: 48,
      body: 'Moves the six billing models into `modules/billing/`. State-only: `db_table` stays, so no table is renamed.\n\nFollow-up: drop the old re-exports in #1808.',
      files: [
        ['modules/billing/models.py', 320, 0],
        ['app/models/__init__.py', 6, 290],
        ['modules/billing/apps.py', 22, 0],
        ['app/migrations/0412_move_billing_models.py', 48, 0],
      ],
      reviews: [['ada', 'CHANGES_REQUESTED', '', undefined, 26], ['lyra', 'APPROVED', '', undefined, 30]],
      comments: [{ id: 'issuecomment-1801-1', author: 'ada', body: '@you is this reversible if the deploy goes wrong halfway?', hoursAgo: 24 }],
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
      size: [140, 12, 3], openedHoursAgo: 20, reviewerTeams: ['acme/team-platform'],
      body: 'Ingestion jobs need more memory than Depot offers. This RFC adds a runner pool and one workflow change.',
      // One workflow file is team-platform's (sample CODEOWNERS): the review it pulls in is small.
      files: [
        ['rfcs/0042-ingestion-runners.md', 110, 0],
        ['infra/runners/ingestion.tf', 18, 8],
        ['.github/workflows/ingestion-ci.yml', 12, 4],
      ],
    }),
    samplePr(clock, {
      number: 1940, title: 'Release desktop 2.3', author: 'mae', state: 'OPEN',
      size: [30, 10, 4], openedHoursAgo: 30, reviews: [['koa', 'APPROVED', '', undefined, 20]],
      comments: [{ id: 'issuecomment-1940-1', author: 'mae', body: '2.3 goes out Thursday.', hoursAgo: 6 }],
    }),
    // Added for the sidebar's sections: your own PRs, a team mention (Team
    // mentioned), a bot bump (Other topics, FYI) and a merged PR with news on
    // it (unread, but calm).
    samplePr(clock, {
      number: 1945, title: 'Cap CI shard retries at 2', author: SAMPLE_VIEWER, state: 'OPEN', draft: true,
      size: [14, 6, 2], openedHoursAgo: 8, reviewerUsers: ['lyra'],
      reviews: [['remy', 'COMMENTED', 'Would 3 hide fewer real flakes?', undefined, 1]],
    }),
    samplePr(clock, {
      number: 1808, title: 'Drop the old billing re-exports', author: SAMPLE_VIEWER, state: 'OPEN',
      // Approved by an agent only: the pill reads "approved by agent", whose turn stays "Merge".
      size: [3, 40, 2], openedHoursAgo: 20, reviews: [['reviewbot[bot]', 'APPROVED', '', undefined, 18]],
    }),
    samplePr(clock, {
      number: 1934, title: 'Ingestion runner pool as a Terraform module', author: 'ines', state: 'OPEN',
      size: [220, 0, 6], openedHoursAgo: 10,
      comments: [{ id: 'issuecomment-5', author: 'ines', body: '@acme/team-platform do the runner labels clash with yours?', hoursAgo: 1.5 }],
    }),
    // A routing team's request (client-approvers, added by an assigner bot) and a routing team's mention.
    samplePr(clock, {
      number: 1966, title: 'Retry uploads with jittered backoff', author: 'koa', state: 'OPEN',
      size: [64, 18, 3], openedHoursAgo: 6, reviewerTeams: ['acme/client-approvers'],
      body: 'Uploads retried at a fixed 1s interval and piled up after an outage. This adds jittered backoff capped at 30s.',
    }),
    samplePr(clock, {
      number: 1967, title: 'Document the new retry settings', author: 'koa', state: 'OPEN',
      size: [40, 4, 2], openedHoursAgo: 5,
      comments: [{ id: 'issuecomment-7', author: 'koa', body: '@acme/client-approvers heads-up: the defaults change in the next release', hoursAgo: 4 }],
    }),
    samplePr(clock, {
      number: 1925, title: 'Bump ruff to 0.7', author: 'renovate[bot]', state: 'OPEN',
      size: [2, 2, 1], openedHoursAgo: 12,
    }),
    samplePr(clock, {
      number: 1857, title: 'Upgrade to Vite 7', author: 'lyra', state: 'MERGED',
      size: [120, 90, 14], openedHoursAgo: 50, mergedHoursAgo: 3,
      // A review bot's review with 4 inline comments folds into one quiet line,
      // and the author's answers fold into one quiet line per bot thread. In
      // one bot thread nell asks you (a line of its own), and one thread is
      // between people. GitHub wraps every thread reply in an empty review of
      // its own, the same second: none of them shows as "reviewed". The answers,
      // the empty reviews and lyra's "@codex review" are bot talk: no agent
      // reads or judges them.
      reviews: [
        [GREPTILE, 'COMMENTED', 'Greptile summary: upgrades Vite to 7 and moves the test setup. 4 comments.', undefined, 30],
        ['lyra', 'COMMENTED', '', undefined, 28],
        ['lyra', 'COMMENTED', '', undefined, 27],
        ['lyra', 'COMMENTED', '', undefined, 26],
        ['nell', 'COMMENTED', '', undefined, 4],
        ['jude', 'APPROVED', '', undefined, 5],
        ['lyra', 'COMMENTED', '', undefined, 24],
      ],
      comments: [
        { id: 'issuecomment-1857-codex', author: 'lyra', body: '@codex review', hoursAgo: 29 },
        { id: 'issuecomment-6', author: 'jude', body: '@you are the stale snapshots gone after this?', hoursAgo: 2 },
      ],
      threads: [
        {
          id: 'thread-1857-1',
          path: 'vite.config.ts',
          comments: [
            { author: GREPTILE, body: '**logic:** `build.target` drops es2019, so older Safari versions fail to load the bundle.', hoursAgo: 30, review: 0 },
            { author: 'lyra', body: 'Fixed, the target is back to es2019 for now.', hoursAgo: 28, review: 1 },
            { author: GREPTILE, body: 'Thanks, that resolves it.', hoursAgo: 27.9 },
            { author: 'lyra', body: 'Also added a browserslist check to CI.', hoursAgo: 27, review: 2 },
          ],
        },
        {
          id: 'thread-1857-2',
          path: 'src/test/setup.ts',
          comments: [
            { author: GREPTILE, body: '**logic:** `vi.useFakeTimers()` is never reset between tests.', hoursAgo: 30, review: 0 },
            { author: 'lyra', body: 'Moved the reset into afterEach.', hoursAgo: 26, review: 3 },
          ],
        },
        {
          id: 'thread-1857-3',
          path: 'vite.config.ts',
          comments: [
            { author: GREPTILE, body: '**style:** The dev server port is hardcoded; the e2e config reads it from the environment.', hoursAgo: 30, review: 0 },
            { author: 'nell', body: '@you is the hardcoded port fine for the devbox?', hoursAgo: 4, review: 4 },
          ],
        },
        {
          id: 'thread-1857-5',
          path: 'package.json',
          comments: [{ author: GREPTILE, body: '**style:** `vite-plugin-legacy` is no longer imported anywhere.', hoursAgo: 30, review: 0 }],
        },
        {
          id: 'thread-1857-4',
          path: 'scripts/check-snapshots.ts',
          comments: [
            { author: 'nell', body: 'Does this still need the old snapshot folder?', hoursAgo: 25 },
            { author: 'lyra', body: 'No, it reads the new one since this PR.', hoursAgo: 24, review: 6 },
          ],
        },
      ],
    }),
    samplePr(clock, {
      number: 1870, title: 'Make devbox start default to minimal stack', author: 'sol', state: 'OPEN',
      size: [70, 12, 4], openedHoursAgo: 72, reviewerTeams: ['acme/team-platform'],
    }),
    // Found outside the inbox: the viewer's own open PR, and a review asked of them they already read on GitHub.
    // Approved, submitted to the Trunk merge queue, and taken out again: its checks never finished.
    samplePr(clock, {
      number: 1950, title: 'Cache pnpm store in the devbox CI image', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [34, 8, 2], openedHoursAgo: 30, reviews: [['lyra', 'APPROVED', '', undefined, 26]],
      comments: [{ id: 'issuecomment-1950-trunk', author: 'trunk-io[bot]', body: TRUNK_REMOVED, hoursAgo: 29, editedHoursAgo: 0.6 }],
    }),
    samplePr(clock, {
      number: 1975, title: 'Pin Depot runner images by digest', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [18, 18, 6], openedHoursAgo: 20, reviews: [['rowan', 'APPROVED', '', undefined, 3]],
      body: 'Runner images float on `:latest` today, so a Depot image update can change CI under us. This pins every image by digest.',
      comments: [{ id: 'issuecomment-1975-trunk', author: 'trunk-io[bot]', body: TRUNK_TESTING, hoursAgo: 2.5, editedHoursAgo: 0.4 }],
    }),
    // The rest of the merge queue in fake mode: submitted (checks still running), waiting, and merged through it.
    samplePr(clock, {
      number: 1977, title: 'Pin the macOS runner image too', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [6, 6, 2], openedHoursAgo: 4, reviews: [['rowan', 'APPROVED', '', undefined, 1.5]],
      comments: [{ id: 'issuecomment-1977-trunk', author: 'trunk-io[bot]', body: TRUNK_SUBMITTED, hoursAgo: 1 }],
    }),
    samplePr(clock, {
      number: 1978, title: 'Drop the floating runner image tag', author: 'rowan', state: 'OPEN',
      size: [2, 9, 3], openedHoursAgo: 6, reviews: [[SAMPLE_VIEWER, 'APPROVED', '', undefined, 2]],
      comments: [{ id: 'issuecomment-1978-trunk', author: 'trunk-io[bot]', body: TRUNK_WAITING, hoursAgo: 1.8, editedHoursAgo: 0.2 }],
    }),
    // The ownership sections' samples.
    samplePr(clock, {
      number: 1980, title: 'Run quarantined tests in their own job', author: 'sol', state: 'OPEN',
      size: [64, 12, 3], openedHoursAgo: 10,
      comments: [{ id: 'issuecomment-1980-1', author: 'sol', body: 'The quarantine job is green on master.', hoursAgo: 8 }],
    }),
    samplePr(clock, {
      number: 1981, title: 'Report retries of quarantined tests', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [48, 4, 2], openedHoursAgo: 4, reviewerUsers: ['sol'],
    }),
    samplePr(clock, {
      number: 1982, title: 'Allow the Depot cache host', author: 'nell', state: 'OPEN',
      size: [3, 0, 1], openedHoursAgo: 9,
      comments: [{ id: 'issuecomment-1982-1', author: 'nell', body: 'Needed for the cache warm-up.', hoursAgo: 9 }],
    }),
    samplePr(clock, {
      number: 1984, title: 'Move recordings older than 30 days to cold storage', author: 'pia', state: 'OPEN',
      size: [210, 40, 9], openedHoursAgo: 28,
      comments: [{ id: 'issuecomment-1984-1', author: 'pia', body: 'Does CI need more disk for the cold-storage tests?', hoursAgo: 0.5 }],
    }),
    samplePr(clock, {
      number: 1985, title: 'Cap the replay player buffer', author: 'gus', state: 'OPEN',
      size: [40, 18, 2], openedHoursAgo: 50,
      comments: [{ id: 'issuecomment-1985-1', author: 'gus', body: 'Buffer capped at 50 MB.', hoursAgo: 30 }],
    }),
    samplePr(clock, {
      number: 1986, title: 'Run usage exports on the shared runners', author: SAMPLE_VIEWER, state: 'OPEN',
      size: [12, 6, 2], openedHoursAgo: 7, reviewerUsers: ['omar'],
    }),
    samplePr(clock, {
      number: 1987, title: 'Add alert threshold presets', author: 'gus', state: 'OPEN',
      size: [90, 5, 4], openedHoursAgo: 40,
      comments: [{ id: 'issuecomment-1987-1', author: 'gus', body: 'Presets ship behind a flag.', hoursAgo: 20 }],
    }),
    samplePr(clock, {
      number: 1988, title: 'Rebuild the docs search index nightly', author: 'tove', state: 'OPEN',
      size: [22, 3, 2], openedHoursAgo: 3,
      comments: [{ id: 'issuecomment-1988-1', author: 'tove', body: 'The index build takes 4 minutes.', hoursAgo: 2 }],
    }),
    samplePr(clock, {
      number: 1989, title: 'Show the uptime badge on the status page', author: 'bram', state: 'MERGED',
      size: [18, 2, 2], openedHoursAgo: 6, mergedHoursAgo: 1, reviews: [['nell', 'APPROVED', '', undefined, 2]],
      comments: [{ id: 'issuecomment-1989-1', author: 'nell', body: 'Badge colours match the design tokens now.', hoursAgo: 3 }],
    }),
    samplePr(clock, {
      number: 1974, title: 'Pin the Linux runner image', author: SAMPLE_VIEWER, state: 'MERGED',
      size: [8, 8, 2], openedHoursAgo: 30, mergedHoursAgo: 5, reviews: [['rowan', 'APPROVED', '', undefined, 7]],
      comments: [{ id: 'issuecomment-1974-trunk', author: 'trunk-io[bot]', body: TRUNK_MERGED, hoursAgo: 6, editedHoursAgo: 5 }],
    }),
    // Addressed your changes, seen on a revisit: you asked for changes
    // yesterday, pim pushed three commits (a review bot and CI chimed in) and
    // never re-requested a review. Back to you; the strip says
    // "3 commits since your changes request".
    samplePr(clock, {
      number: 1960, title: 'Split the toolbar into its own bundle', author: 'pim', state: 'OPEN',
      size: [260, 90, 9], openedHoursAgo: 50,
      reviews: [[SAMPLE_VIEWER, 'CHANGES_REQUESTED', 'The chunk names change on every build, which busts the CDN cache.', 'sha1960-a', 30]],
      threads: [
        {
          id: 'thread-1960-1',
          path: 'frontend/vite.config.ts',
          comments: [{ author: SAMPLE_VIEWER, body: 'Can these chunk names be stable?', hoursAgo: 30 }],
        },
      ],
      comments: [
        { id: 'issuecomment-1960-reviewbot', author: 'reviewbot[bot]', body: 'No issues found in 9 files.', hoursAgo: 2.1 },
        { id: 'issuecomment-1960-sizebot', author: 'sizebot[bot]', body: 'toolbar.js -18 kB', hoursAgo: 2 },
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
      size: [80, 30, 5], openedHoursAgo: 40,
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
      size: [12, 4, 2], openedHoursAgo: 26, reviewerUsers: [SAMPLE_VIEWER],
    }),
    // Agent PRs: a coding agent's GitHub App opens them on someone's behalf
    // and assigns that person, who owns the PR. #1970 is the viewer's own
    // (Your PR, waiting on lyra); #1972 belongs to three teammates,
    // so the platform team request on it is the viewer's (For you).
    samplePr(clock, {
      number: 1970, title: 'Check that billing migrations stay state-only', author: SAMPLE_AGENT, assignees: [SAMPLE_VIEWER], state: 'OPEN',
      size: [28, 6, 2], openedHoursAgo: 5, headRef: 'acme-agent/billing-migration-check', reviewerUsers: ['lyra'],
      body: 'Opened by the coding agent for @you. Fails CI when a billing migration renames or drops a table.',
    }),
    samplePr(clock, {
      number: 1972, title: 'Drop unused env vars from devbox start', author: SAMPLE_AGENT, assignees: ['rowan', 'sol', 'nell'], state: 'OPEN',
      size: [4, 19, 3], openedHoursAgo: 4, headRef: 'acme-agent/devbox-env-cleanup', reviewerTeams: ['acme/team-platform'],
      body: 'Opened by the coding agent for @rowan. Removes env vars no devbox service reads.',
    }),
  ];
}

// Summaries read like core's `deriveEvents` writes them ("lyra asked you: …",
// "remy requested a review from acme/team-platform", "lyra merged"), and an
// event about a comment, review or commit points at it with `sourceId`, so
// Reply and Thumbs up show as they would in the app (sample-fidelity.test.ts).
function buildEvents(clock: SampleClock): PrEvent[] {
  return [
    ...sampleEvents(clock, 1902, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 5, rule: 'loud', seen: true },
      { kind: 'deploy', actor: 'deploy-bot', text: 'deployed a preview', hoursAgo: 1, rule: 'quiet', isBot: true },
      { kind: 'question_to_user', actor: 'lyra', text: 'asked you: @you does the warm-up job need a feature flag, or is one cold hour fine?', sourceId: 'issuecomment-2', hoursAgo: 0.3, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1904, [
      { kind: 'review_requested', actor: 'lyra', text: 'requested a review from you', hoursAgo: 8, rule: 'loud', seen: true },
    ]),
    ...sampleEvents(clock, 1907, [
      { kind: 'review_requested', actor: 'lyra', text: 'requested a review from you', hoursAgo: 7, rule: 'loud', seen: true },
      { kind: 'question_to_user', actor: 'lyra', text: 'asked you: @you ok to drop the salt now that keys come from the lockfile?', sourceId: 'issuecomment-5', hoursAgo: 0.8, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1921, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'pushed: Bump turbo to 2.5', hoursAgo: 3, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1855, [
      { kind: 'merged', actor: 'jude', text: 'merged', hoursAgo: 14, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1911, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 6, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved: Labels match #1880.', hoursAgo: 4, rule: 'quiet', sourceId: 'review-1911-0', seen: true },
      { kind: 'commits_after_approval', actor: 'rowan', text: 'pushed: Bump Playwright shard count to 6', hoursAgo: 0.25, rule: 'quiet', sourceId: 'sha1911-b' },
      {
        kind: 'commits_after_approval',
        actor: 'rowan',
        text: 'pushed: Pin the Depot runner image',
        hoursAgo: 0.15,
        rule: 'quiet',
        sourceId: 'sha1911',
        raisedBecause: 'Changes the CI runner image you approved, not a plain follow-up.',
      },
    ]),
    ...sampleEvents(clock, 1862, [
      { kind: 'merged', actor: 'rowan', text: 'merged', hoursAgo: 72, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1851, [
      { kind: 'merged', actor: 'rowan', text: 'merged', hoursAgo: 144, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1915, [
      { kind: 'team_mention', actor: 'rowan', text: 'mentioned your team: @acme/team-platform keeping DEPOT_TOKEN a repo secret for now.', hoursAgo: 25, rule: 'loud', sourceId: 'issuecomment-4' },
    ]),
    ...sampleEvents(clock, 1899, [
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 24, rule: 'quiet', sourceId: 'review-1899-0', seen: true },
      {
        kind: 'force_pushed', actor: 'renovate[bot]', text: 'force-pushed', hoursAgo: 3, rule: 'quiet', isBot: true,
        mutedBecause: 'Bot rebase, no content change.',
      },
      { kind: 'merge_queue', actor: 'mergify[bot]', text: 'added it to the merge queue', hoursAgo: 1, rule: 'quiet', sourceId: 'queue-1899', isBot: true },
    ]),
    ...sampleEvents(clock, 1840, [
      { kind: 'review_requested', actor: 'nell', text: 'requested a review from you', hoursAgo: 150, rule: 'loud', seen: true },
      { kind: 'merged', actor: 'nell', text: 'merged', hoursAgo: 120, rule: 'quiet', seen: true },
    ]),
    ...sampleEvents(clock, 1790, [
      { kind: 'merged_without_review', actor: 'nell', text: 'merged', hoursAgo: 48, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 1822, [
      { kind: 'review_requested', actor: 'remy', text: 'requested a review from acme/team-platform', hoursAgo: 72, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1801, [
      { kind: 'question_to_user', actor: 'ada', text: 'asked you: @you is this reversible if the deploy goes wrong halfway?', hoursAgo: 24, rule: 'loud', sourceId: 'issuecomment-1801-1' },
    ]),
    ...sampleEvents(clock, 1932, [
      { kind: 'review_requested', actor: 'ines', text: 'requested a review from acme/team-platform', hoursAgo: 2, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1940, [
      { kind: 'comment', actor: 'mae', text: 'commented: 2.3 goes out Thursday.', hoursAgo: 6, rule: 'quiet', sourceId: 'issuecomment-1940-1' },
    ]),
    ...sampleEvents(clock, 1945, [
      { kind: 'review_commented', actor: 'remy', text: 'reviewed: Would 3 hide fewer real flakes?', hoursAgo: 1, rule: 'quiet', sourceId: 'review-1945-0', seen: true },
    ]),
    // Trunk's status edits: the one that took your PR out of the queue is loud (DESIGN.md "Merge queue").
    ...sampleEvents(clock, 1950, [
      { kind: 'review_approved', actor: 'lyra', text: 'approved', hoursAgo: 26, rule: 'loud', sourceId: 'review-1950-0', seen: true },
      {
        kind: 'comment_edited',
        actor: 'trunk-io[bot]',
        text: 'updated its comment: 🚫 This pull request was removed from the merge queue because it was waiting to become mergeable fo…',
        hoursAgo: 0.6,
        rule: 'loud',
        sourceId: 'issuecomment-1950-trunk',
        isBot: true,
      },
    ]),
    ...sampleEvents(clock, 1974, [
      { kind: 'merged', actor: 'trunk-io[bot]', text: 'merged', hoursAgo: 5, rule: 'quiet', seen: true, isBot: true },
    ]),
    ...sampleEvents(clock, 1978, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 5, rule: 'loud', seen: true },
      { kind: 'review_approved', actor: SAMPLE_VIEWER, text: 'approved', hoursAgo: 2, rule: 'quiet', sourceId: 'review-1978-0', seen: true },
    ]),
    ...sampleEvents(clock, 1975, [
      { kind: 'review_approved', actor: 'rowan', text: 'approved', hoursAgo: 3, rule: 'loud', sourceId: 'review-1975-0', seen: true },
      {
        kind: 'comment_edited',
        actor: 'trunk-io[bot]',
        text: 'updated its comment: 🧪 Running tests on this pull request (testing on PR [#1976](https://github.com/acme/app/pull/1976)…',
        hoursAgo: 0.4,
        rule: 'quiet',
        sourceId: 'issuecomment-1975-trunk',
        isBot: true,
      },
    ]),
    ...sampleEvents(clock, 1934, [
      { kind: 'team_mention', actor: 'ines', text: 'mentioned your team: @acme/team-platform do the runner labels clash with yours?', hoursAgo: 1.5, rule: 'loud', sourceId: 'issuecomment-5' },
    ]),
    ...sampleEvents(clock, 1966, [
      { kind: 'review_requested', actor: 'pr-assigner[bot]', text: 'requested a review from acme/client-approvers', hoursAgo: 5.5, rule: 'loud', isBot: true },
    ]),
    ...sampleEvents(clock, 1967, [
      { kind: 'team_mention', actor: 'koa', text: 'mentioned your team: @acme/client-approvers heads-up: the defaults change in the next release', hoursAgo: 4, rule: 'quiet', sourceId: 'issuecomment-7' },
    ]),
    ...sampleEvents(clock, 1925, [
      { kind: 'commits_pushed', actor: 'renovate[bot]', text: 'pushed: Bump ruff to 0.7', hoursAgo: 12, rule: 'quiet', isBot: true },
    ]),
    ...sampleEvents(clock, 1857, [
      { kind: 'review_commented', actor: GREPTILE, text: 'reviewed: Greptile summary: upgrades Vite to 7 and moves the test setup. 4 comments.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'review-1857-0', seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'commented: Greptile summary: upgrades Vite to 7 and moves the test setup. 4 comments.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'review-1857-0', seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'commented: **logic:** `build.target` drops es2019, so older Safari versions fail to load the bundle.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'thread-1857-1-0', seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'commented: **logic:** `vi.useFakeTimers()` is never reset between tests.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'thread-1857-2-0', seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'commented: **style:** The dev server port is hardcoded; the e2e config reads it from the environment.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'thread-1857-3-0', seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'commented: **style:** `vite-plugin-legacy` is no longer imported anywhere.', hoursAgo: 30, rule: 'quiet', isBot: true, sourceId: 'thread-1857-5-0', seen: true },
      { kind: 'comment', actor: 'lyra', text: 'commented: @codex review', hoursAgo: 29, rule: 'quiet', sourceId: 'issuecomment-1857-codex', seen: true, chatter: true },
      { kind: 'comment', actor: 'lyra', text: `replied to ${GREPTILE} on vite.config.ts: Fixed, the target is back to es2019 for now.`, hoursAgo: 28, rule: 'quiet', sourceId: 'thread-1857-1-1', chatter: true, seen: true },
      { kind: 'review_commented', actor: 'lyra', text: 'reviewed', hoursAgo: 28, rule: 'quiet', sourceId: 'review-1857-1', chatter: true, seen: true },
      { kind: 'bot_comment', actor: GREPTILE, text: 'replied to lyra on vite.config.ts: Thanks, that resolves it.', hoursAgo: 27.9, rule: 'quiet', isBot: true, sourceId: 'thread-1857-1-2', seen: true },
      { kind: 'comment', actor: 'lyra', text: `replied to ${GREPTILE} on vite.config.ts: Also added a browserslist check to CI.`, hoursAgo: 27, rule: 'quiet', sourceId: 'thread-1857-1-3', chatter: true, seen: true },
      { kind: 'review_commented', actor: 'lyra', text: 'reviewed', hoursAgo: 27, rule: 'quiet', sourceId: 'review-1857-2', chatter: true, seen: true },
      { kind: 'comment', actor: 'lyra', text: `replied to ${GREPTILE} on src/test/setup.ts: Moved the reset into afterEach.`, hoursAgo: 26, rule: 'quiet', sourceId: 'thread-1857-2-1', chatter: true, seen: true },
      { kind: 'review_commented', actor: 'lyra', text: 'reviewed', hoursAgo: 26, rule: 'quiet', sourceId: 'review-1857-3', chatter: true, seen: true },
      { kind: 'comment', actor: 'nell', text: 'commented: Does this still need the old snapshot folder?', hoursAgo: 25, rule: 'quiet', sourceId: 'thread-1857-4-0', seen: true },
      { kind: 'comment', actor: 'lyra', text: 'replied to nell on scripts/check-snapshots.ts: No, it reads the new one since this PR.', hoursAgo: 24, rule: 'quiet', sourceId: 'thread-1857-4-1', seen: true },
      { kind: 'review_commented', actor: 'lyra', text: 'reviewed', hoursAgo: 24, rule: 'quiet', sourceId: 'review-1857-6', chatter: true, seen: true },
      { kind: 'question_to_user', actor: 'nell', text: 'asked you: @you is the hardcoded port fine for the devbox?', hoursAgo: 4, rule: 'loud', sourceId: 'thread-1857-3-1' },
      { kind: 'review_commented', actor: 'nell', text: 'reviewed', hoursAgo: 4, rule: 'quiet', sourceId: 'review-1857-4', chatter: true },
      { kind: 'merged', actor: 'lyra', text: 'merged', hoursAgo: 3, rule: 'quiet', seen: true },
      { kind: 'question_to_user', actor: 'jude', text: 'asked you: @you are the stale snapshots gone after this?', hoursAgo: 2, rule: 'loud', sourceId: 'issuecomment-6' },
    ]),
    ...sampleEvents(clock, 1870, [
      { kind: 'review_requested', actor: 'sol', text: 'requested a review from acme/team-platform', hoursAgo: 72, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1960, [
      { kind: 'review_changes_requested', actor: SAMPLE_VIEWER, text: 'requested changes: The chunk names change on every build, which busts the CDN cache.', hoursAgo: 30, rule: 'quiet', sourceId: 'review-1960-0', seen: true },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Hash chunk names from the entry path', hoursAgo: 3, rule: 'loud', sourceId: 'sha1960-b' },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Keep the vendor chunk name fixed', hoursAgo: 2.6, rule: 'loud', sourceId: 'sha1960-c' },
      { kind: 'commits_pushed', actor: 'pim', text: 'pushed: Stable chunk names for the toolbar', hoursAgo: 2.2, rule: 'loud', sourceId: 'sha1960' },
      { kind: 'bot_comment', actor: 'reviewbot[bot]', text: 'commented: No issues found in 9 files.', hoursAgo: 2.1, rule: 'quiet', isBot: true, sourceId: 'issuecomment-1960-reviewbot' },
      { kind: 'bot_comment', actor: 'sizebot[bot]', text: 'commented: toolbar.js -18 kB', hoursAgo: 2, rule: 'quiet', isBot: true, sourceId: 'issuecomment-1960-sizebot' },
    ]),
    ...sampleEvents(clock, 1963, [
      { kind: 'review_changes_requested', actor: SAMPLE_VIEWER, text: 'requested changes: Inlining drops the long cache on the icon sprite.', hoursAgo: 20, rule: 'quiet', sourceId: 'review-1963-0', seen: true },
    ]),
    ...sampleEvents(clock, 1972, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from acme/team-platform', hoursAgo: 3, rule: 'loud' },
    ]),
    ...sampleEvents(clock, 1980, [
      { kind: 'comment', actor: 'sol', text: 'commented: The quarantine job is green on master.', hoursAgo: 8, rule: 'quiet', sourceId: 'issuecomment-1980-1', seen: true },
    ]),
    ...sampleEvents(clock, 1982, [
      { kind: 'comment', actor: 'nell', text: 'commented: Needed for the cache warm-up.', hoursAgo: 9, rule: 'quiet', sourceId: 'issuecomment-1982-1', seen: true },
    ]),
    // Unread with an open PR and loud news: urgent, so the row stays visible while Other work is folded.
    ...sampleEvents(clock, 1984, [
      { kind: 'comment', actor: 'pia', text: 'commented: Does CI need more disk for the cold-storage tests?', hoursAgo: 0.5, rule: 'loud', sourceId: 'issuecomment-1984-1' },
    ]),
    ...sampleEvents(clock, 1985, [
      { kind: 'comment', actor: 'gus', text: 'commented: Buffer capped at 50 MB.', hoursAgo: 30, rule: 'quiet', sourceId: 'issuecomment-1985-1', seen: true },
    ]),
    ...sampleEvents(clock, 1987, [
      { kind: 'comment', actor: 'gus', text: 'commented: Presets ship behind a flag.', hoursAgo: 20, rule: 'quiet', sourceId: 'issuecomment-1987-1', seen: true },
    ]),
    ...sampleEvents(clock, 1988, [
      { kind: 'comment', actor: 'tove', text: 'commented: The index build takes 4 minutes.', hoursAgo: 2, rule: 'quiet', sourceId: 'issuecomment-1988-1' },
    ]),
    // Read up to the merge: the merge is the only unseen news.
    ...sampleEvents(clock, 1989, [
      { kind: 'comment', actor: 'nell', text: 'commented: Badge colours match the design tokens now.', hoursAgo: 3, rule: 'quiet', sourceId: 'issuecomment-1989-1', seen: true },
      { kind: 'review_approved', actor: 'nell', text: 'approved', hoursAgo: 2, rule: 'quiet', sourceId: 'review-1989-0', seen: true },
      { kind: 'merged', actor: 'bram', text: 'merged', hoursAgo: 1, rule: 'quiet' },
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
      basis: {
        risk: { checked: false, note: 'inferred from the description' },
        verdict: { checked: true, note: 'changed files and comments' },
      },
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
      forYou: 'lyra and sol approved, so platform has looked. It changes what the flaky-test report reads.',
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
    sampleGlance(clock, 1970, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your agent PR; lyra has the review.',
      does: 'Adds a CI check that fails when a billing migration renames or drops a table.',
      risk: 'Low. A new check, nothing changes at runtime.',
      othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 1972, {
      verdict: 'LOOKS_SAFE',
      forYou: "Rowan's agent PR asks platform for a review; nobody on the team picked it up yet.",
      does: 'Removes three env vars no devbox service reads.',
      risk: 'Low. A service that did read one would fall back to its default.',
      othersSaid: 'No comments yet.',
    }),
    sampleGlance(clock, 1870, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Changes a devbox default, which you asked to see first.',
      does: 'Skips ClickHouse and Kafka by default.',
      risk: 'People lose services silently.',
      othersSaid: 'None yet.',
    }),
    // A subscribed thread the agent calls Not yours: its tile menu leaves out "Not mine".
    sampleGlance(clock, 1940, {
      verdict: 'NOT_YOURS',
      forYou: 'A desktop release thread you follow. Nothing in it touches CI or runners.',
      does: 'Bumps the desktop app to 2.3 and updates its changelog.',
      risk: 'Low. A version bump, nothing platform owns.',
      othersSaid: 'koa approved.',
    }),
    // Most open PRs have a glance, as on a healthy install. #1945 (catch-up at start), #1808
    // (failed, Retry) and #1988 (skipped by the agent-call cap) have none, so those states show.
    sampleGlance(clock, 1934, {
      verdict: 'LOOK_CLOSER',
      forYou: 'ines asks platform whether the new runner labels clash with yours.',
      does: 'Adds a Terraform module for a self-hosted ingestion runner pool.',
      risk: 'Medium. A label that matches a platform runner would pull platform jobs onto the pool.',
      othersSaid: 'No reviews yet; ines asked platform directly.',
    }),
    sampleGlance(clock, 1925, {
      verdict: 'LOOKS_SAFE',
      forYou: 'A pinned linter bump. Nothing in it touches CI or runners.',
      does: 'Bumps ruff from 0.6 to 0.7 in the Python SDK.',
      risk: 'Low. New lint rules could fail CI, nothing changes at runtime.',
      othersSaid: 'No human comments.',
    }),
    sampleGlance(clock, 1966, {
      verdict: 'LOOK_CLOSER',
      forYou: 'client-approvers is asked to sign off; the retry cap changes how long a failed upload holds on.',
      does: 'Retries uploads with jittered backoff, capped at 30s.',
      risk: 'Medium. A 30s cap can outlast a client timeout.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1967, {
      verdict: 'LOOKS_SAFE',
      forYou: 'koa keeps client-approvers posted. Docs only.',
      does: 'Documents the new retry settings and their defaults.',
      risk: 'Low. Docs only.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1960, {
      verdict: 'LOOK_CLOSER',
      forYou: 'pim pushed stable chunk names, which is what you asked for.',
      does: 'Splits the toolbar into its own bundle; chunk names come from the entry path.',
      risk: 'Low. Names stay the same across builds, so the CDN cache holds.',
      othersSaid: 'You asked for changes; reviewbot found no issues.',
    }),
    sampleGlance(clock, 1963, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Still as you left it: tove has not answered your sprite question.',
      does: 'Inlines SVG icons under 4 kB into the bundle.',
      risk: 'Low. Inlined icons lose the long cache of the sprite.',
      othersSaid: 'You asked for changes.',
    }),
    sampleGlance(clock, 1932, {
      verdict: 'LOOK_CLOSER',
      forYou: 'Only the ingestion workflow file belongs to platform; the rest is the RFC.',
      does: 'Proposes a self-hosted runner pool for ingestion CI and changes one workflow.',
      risk: 'Medium. One more runner pool to run and patch.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1950, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your PR fell out of the merge queue because its checks never finished.',
      does: 'Caches the pnpm store in the devbox CI image.',
      risk: 'Low. A stale cache only slows the first install.',
      othersSaid: 'lyra approved.',
    }),
    sampleGlance(clock, 1975, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your PR is testing in the merge queue.',
      does: 'Pins every Depot runner image by digest instead of :latest.',
      risk: 'Low. An image update becomes a PR, not a surprise.',
      othersSaid: 'rowan approved.',
    }),
    sampleGlance(clock, 1977, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your PR is submitted to the merge queue and waits for its checks.',
      does: 'Pins the macOS runner image by digest.',
      risk: 'Low. Same image, pinned.',
      othersSaid: 'rowan approved.',
    }),
    sampleGlance(clock, 1978, {
      verdict: 'LOOKS_SAFE',
      forYou: 'You approved; it waits in the merge queue.',
      does: 'Drops the floating :latest tag from the runner config.',
      risk: 'Low. The images are pinned by digest.',
      othersSaid: 'You approved.',
    }),
    sampleGlance(clock, 1955, {
      verdict: 'LOOKS_SAFE',
      forYou: 'nell asks you to review the Playwright browser pin.',
      does: 'Pins the Playwright browser version so e2e runs stop drifting.',
      risk: 'Low. A browser update becomes a PR.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1980, {
      verdict: 'LOOKS_SAFE',
      forYou: 'The quarantine job sol drives; your retry report builds on it.',
      does: 'Runs quarantined tests in their own job that never blocks a merge.',
      risk: 'Medium. A real failure in a quarantined test waits until someone looks.',
      othersSaid: 'sol says the job is green on master.',
    }),
    sampleGlance(clock, 1981, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your PR; sol has the review.',
      does: 'Reports how often quarantined tests retry.',
      risk: 'Low. A report, nothing blocks on it.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1982, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Adds the Depot cache host to the egress allowlist your team keeps.',
      does: 'Allows outbound traffic from the runners to the Depot cache host.',
      risk: 'Low. One more host the runners may reach.',
      othersSaid: 'nell says the cache warm-up needs it.',
    }),
    sampleGlance(clock, 1984, {
      verdict: 'LOOK_CLOSER',
      forYou: 'pia asks whether CI needs more disk for the cold-storage tests; that is a CI question.',
      does: 'Moves recordings older than 30 days to cold storage.',
      risk: 'Medium. Recordings move between stores.',
      othersSaid: 'pia asked about CI disk.',
    }),
    sampleGlance(clock, 1985, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Replay player work. Nothing in it touches CI.',
      does: 'Caps the replay player buffer at 50 MB.',
      risk: 'Low. Long recordings load in parts.',
      othersSaid: 'gus says the buffer is capped at 50 MB.',
    }),
    sampleGlance(clock, 1986, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Your PR; omar has the review.',
      does: 'Runs usage exports on the shared runners.',
      risk: 'Low. Exports wait in the shared queue on busy mornings.',
      othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 1987, {
      verdict: 'LOOKS_SAFE',
      forYou: 'Alerting work. Nothing in it touches CI.',
      does: 'Adds presets for common alert thresholds.',
      risk: 'Low. Ships behind a flag.',
      othersSaid: 'gus says presets ship behind a flag.',
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
      [1907],
    ),
    sampleTile(TOPIC.depot, 'stack', `stack:${sampleKey(1851)}`, "rowan/depot: cache layer has lyra's question for you", [
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
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1822)}`, 'Timing-based shards, approved by lyra and sol', [
      pinged(1822, 'review_requested'),
    ]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1945)}`, 'Your shard retry cap waits on lyra', [pinged(1945, 'author')]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(1801)}`, 'Ada asks if the billing move is reversible', [
      pinged(1801, 'author'),
    ]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(1808)}`, 'Old billing re-exports are approved', [pinged(1808, 'author')]),
    sampleTile(TOPIC.ingestion, 'single', `pr:${sampleKey(1934)}`, 'Ingestion asks platform about runner labels', [pinged(1934, 'team_mention')]),
    sampleTile(TOPIC.deps, 'single', `pr:${sampleKey(1925)}`, 'Bump ruff to 0.7', [pinged(1925, 'subscribed')]),
    sampleTile(TOPIC.sdk, 'single', `pr:${sampleKey(1966)}`, 'client-approvers is asked to sign off on upload retries', [
      pinged(1966, 'review_requested'),
    ]),
    sampleTile(TOPIC.sdk, 'single', `pr:${sampleKey(1967)}`, 'Retry settings docs, client-approvers kept posted', [pinged(1967, 'team_mention')]),
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
    sampleTile(TOPIC.runners, 'single', `pr:${sampleKey(1975)}`, 'Your runner image pins are testing in the merge queue', [pinged(1975, 'author')]),
    sampleTile(TOPIC.runners, 'single', `pr:${sampleKey(1977)}`, 'Your macOS image pin waits for its checks', [found(1977, 'own_open', 'your open PR')]),
    sampleTile(TOPIC.runners, 'single', `pr:${sampleKey(1978)}`, "Rowan's floating tag removal is queued", [pinged(1978, 'review_requested')]),
    sampleTile(TOPIC.runners, 'single', `pr:${sampleKey(1974)}`, 'Linux image pin merged through the queue', [pinged(1974, 'author')]),
    sampleTile(TOPIC.ci, 'single', `pr:${sampleKey(1955)}`, 'nell wants your review on the Playwright pin', [
      found(1955, 'review_requested', 'review requested from you'),
    ]),
    sampleTile(TOPIC.quarantine, 'single', `pr:${sampleKey(1980)}`, 'sol runs quarantined tests apart', [pinged(1980, 'subscribed')]),
    sampleTile(TOPIC.quarantine, 'single', `pr:${sampleKey(1981)}`, 'Your retry report waits on sol', [found(1981, 'own_open', 'your open PR')]),
    sampleTile(TOPIC.egress, 'single', `pr:${sampleKey(1982)}`, 'nell allows the Depot cache host', [pinged(1982, 'subscribed')]),
    sampleTile(TOPIC.replayStorage, 'single', `pr:${sampleKey(1984)}`, 'pia: does CI need more disk for cold storage?', [pinged(1984, 'subscribed')]),
    sampleTile(TOPIC.replayPlayer, 'single', `pr:${sampleKey(1985)}`, 'Replay player buffer capped', [pinged(1985, 'subscribed')]),
    sampleTile(TOPIC.usageExports, 'single', `pr:${sampleKey(1986)}`, 'Your export runner change waits on omar', [found(1986, 'own_open', 'your open PR')]),
    sampleTile(TOPIC.alertPresets, 'single', `pr:${sampleKey(1987)}`, 'Alert threshold presets', [pinged(1987, 'subscribed')]),
    sampleTile(TOPIC.docsSearch, 'single', `pr:${sampleKey(1988)}`, 'Nightly docs search index', [pinged(1988, 'subscribed')]),
    sampleTile(TOPIC.statusBadge, 'single', `pr:${sampleKey(1989)}`, 'Uptime badge on the status page', [pinged(1989, 'subscribed')]),
    sampleTile(TOPIC.migrations, 'single', `pr:${sampleKey(1970)}`, 'Your agent PR guards the billing migrations', [pinged(1970, 'assign')]),
    sampleTile(TOPIC.devEnv, 'single', `pr:${sampleKey(1972)}`, "Rowan's agent PR drops unused devbox env vars", [
      pinged(1972, 'review_requested'),
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
  return membership;
}

export function buildSampleData(now: Date, extras: Set<FakeExtra> = new Set()): SampleData {
  const clock = new SampleClock(now);
  const tiles = buildTiles();
  const data: SampleData = {
    viewer: SAMPLE_VIEWER,
    viewerTeams: ['acme/team-platform', 'acme/client-approvers'],
    viewerHomeTeams: ['acme/team-platform'],
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
    codeOwners: new Map([['acme/app', SAMPLE_CODEOWNERS]]),
    prEdits: [],
  };
  addFakeExtras(data, clock, extras);
  return data;
}
