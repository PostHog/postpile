// Engine memory v2 for the Depot sample: dossiers with a few versions, facts
// with provenance, standing-rule proposals and seen cursors. Used by
// FakeMemory, so the desktop app can show memory without GitHub or the agent.
import type {
  Cursor,
  Dossier,
  DossierVersion,
  EntityRef,
  Fact,
  FactPredicate,
  FactRef,
  FactRefKind,
  Feedback,
  LineSources,
  RuleProposal,
  UserRef,
  UserRefKind,
} from '@code-manager/core';
import { SAMPLE_REPO, SampleClock, sampleKey } from './sample-builders.ts';

export interface SampleMemory {
  /** Every stored version per topic, oldest first. */
  dossiers: Map<string, DossierVersion[]>;
  facts: Fact[];
  ruleProposals: RuleProposal[];
  /** What the next consolidation run files, once. */
  nextRuleProposals: RuleProposal[];
  seen: Map<string, Cursor>;
  /** The "not mine" feedback the standing-rule proposal cites. */
  feedback: Feedback[];
}

const DEPOT = 'topic-depot';
const FRONTEND = 'topic-frontend-build';
const CI = 'topic-ci-tests';

function ref(clock: SampleClock, kind: FactRefKind, number: number, hoursAgo: number, sourceId: string | null = null): FactRef {
  const url = sourceId ? `https://github.com/${SAMPLE_REPO}/pull/${number}#${sourceId}` : `https://github.com/${SAMPLE_REPO}/pull/${number}`;
  return { kind, prKey: sampleKey(number), sourceId, url, at: clock.hoursAgo(hoursAgo), headOid: null };
}

function userRef(clock: SampleClock, kind: UserRefKind, id: string, hoursAgo: number, quote: string): UserRef {
  return { kind, id, at: clock.hoursAgo(hoursAgo), quote };
}

function prRef(clock: SampleClock, number: number, hoursAgo: number): FactRef {
  return ref(clock, 'pr', number, hoursAgo);
}

function sources(refs: FactRef[], userRefs: UserRef[] = []): LineSources {
  return { refs, userRefs };
}

/** The Depot topic tailoring, as a dossier line cites it. */
function depotTailoring(clock: SampleClock): UserRef {
  return userRef(clock, 'tailoring', DEPOT, 1, 'Rowan drives, I approve. Flag cache keys, runner labels, secrets.');
}

function person(login: string): EntityRef {
  return { kind: 'person', key: login };
}

function pr(number: number): EntityRef {
  return { kind: 'pr', key: sampleKey(number) };
}

interface SampleFactInput {
  id: string;
  subject: EntityRef;
  predicate: FactPredicate;
  object: EntityRef | null;
  text: string;
  topicId: string;
  refs: FactRef[];
  recordedHoursAgo: number;
}

function sampleFact(clock: SampleClock, input: SampleFactInput): Fact {
  const recordedAt = clock.hoursAgo(input.recordedHoursAgo);
  return {
    id: input.id,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    text: input.text,
    topicId: input.topicId,
    source: 'agent',
    refs: input.refs,
    validFrom: input.refs[0]?.at ?? recordedAt,
    invalidAt: null,
    invalidReason: null,
    supersededBy: null,
    recordedAt,
    expiredAt: null,
    staleAt: null,
    staleReason: null,
    verifiedAt: recordedAt,
  };
}

function depotDossierV1(clock: SampleClock): Dossier {
  return {
    goal: 'Run PostHog CI on Depot runners to cut queue time and cost.',
    goalSources: sources([prRef(clock, 41851, 170)]),
    summary: 'Project config is in. Backend jobs are next.',
    status: 'starting',
    statusNote: 'Only the Depot project config exists so far.',
    statusSources: sources([prRef(clock, 41851, 144)]),
    people: [{ login: 'rowan', role: 'driver', note: 'Opened the rowan/depot stack.' }],
    openQuestions: [
      { text: 'Keep GitHub runners for release builds?', askedBy: 'nell', refs: [ref(clock, 'comment', 41851, 150, 'issuecomment-1')] },
    ],
    timeline: [{ prKey: sampleKey(41851), role: 'Adds depot.json, base of the stack.', refs: [prRef(clock, 41851, 170)] }],
    earlier: '',
    userCares: [
      { text: 'Cache keys and Turbo hashing', source: 'tailoring', userRefs: [depotTailoring(clock)] },
      { text: 'CI cost per run', source: 'instructions', userRefs: [userRef(clock, 'instructions', '3', 40, 'Edited outside the app')] },
    ],
    recentChanges: [{ at: clock.hoursAgo(144), text: 'Depot project config merged (#41851).', refs: [ref(clock, 'pr', 41851, 144)] }],
  };
}

function depotDossierV2(clock: SampleClock): Dossier {
  const v1 = depotDossierV1(clock);
  return {
    ...v1,
    summary: 'Backend jobs run on Depot. The token went in as a repo secret. Frontend and cache are next.',
    status: 'active',
    statusNote: 'Backend moved, no blockers.',
    statusSources: sources([prRef(clock, 41862, 72)]),
    people: [...v1.people, { login: 'lyra', role: 'reviewer', note: 'Approves the workflow changes.' }],
    openQuestions: [
      ...v1.openQuestions,
      { text: 'Repo secret or the existing org secret for DEPOT_TOKEN?', askedBy: null, refs: [ref(clock, 'pr', 41915, 30)] },
    ],
    timeline: [
      ...v1.timeline,
      { prKey: sampleKey(41862), role: 'Moves backend jobs to Depot.', refs: [prRef(clock, 41862, 96)] },
      { prKey: sampleKey(41915), role: 'Adds DEPOT_TOKEN as a repo secret.', refs: [ref(clock, 'comment', 41915, 25, 'issuecomment-4')] },
      // Written before lines carried sources: shows "no source recorded".
      { prKey: sampleKey(41899), role: 'Renames workflow files to ci-*.yml.' },
    ],
    userCares: [
      ...v1.userCares,
      {
        text: 'Runner labels and secrets',
        source: 'tailoring',
        userRefs: [depotTailoring(clock), userRef(clock, 'feedback', '5', 26, 'asked to keep this for the topic: flag runner labels too')],
      },
    ],
    recentChanges: [
      { at: clock.hoursAgo(24), text: 'DEPOT_TOKEN merged as a repo secret, though an org secret exists (#41915).', refs: [ref(clock, 'pr', 41915, 24)] },
      { at: clock.hoursAgo(72), text: 'Backend jobs run on Depot (#41862 merged).', refs: [ref(clock, 'pr', 41862, 72)] },
      ...v1.recentChanges,
    ],
  };
}

function depotDossierV3(clock: SampleClock): Dossier {
  const v2 = depotDossierV2(clock);
  return {
    ...v2,
    summary: 'Backend and frontend run on Depot. Turbo caching and e2e are in flight. The release workflow has no PR yet.',
    statusNote: 'Cache and e2e layers wait on reviews; the cache PR fails its warm-up job.',
    // Written against the commit before the latest push, so "Why?" shows it as stale.
    statusSources: sources([{ ...ref(clock, 'commit', 41902, 4, 'a1b2c3'), headOid: 'a1b2c3' }, ref(clock, 'review', 41902, 1, 'review-41902-0')]),
    people: [
      { login: 'rowan', role: 'driver', note: 'Owns the rollout, stacks rowan/depot-*.' },
      { login: 'lyra', role: 'reviewer', note: 'Approves workflow changes, asked about the warm-up.' },
      { login: 'nell', role: 'reviewer', note: 'Asked to keep GitHub runners for releases.' },
      { login: 'jude', role: 'contributor', note: 'Turned off the Storybook cache in #41855.' },
    ],
    openQuestions: [
      {
        text: 'Does the Turbo cache warm-up need a feature flag?',
        askedBy: 'lyra',
        refs: [ref(clock, 'comment', 41902, 0.3, 'issuecomment-2'), ref(clock, 'event', 41902, 0.3, `${sampleKey(41902)}:mention:s41902-2`)],
      },
      ...v2.openQuestions,
    ],
    timeline: [
      ...v2.timeline,
      { prKey: sampleKey(41902), role: 'Points the Turbo remote cache at Depot.', refs: [prRef(clock, 41902, 5), ref(clock, 'review', 41902, 1, 'review-41902-1')] },
      { prKey: sampleKey(41911), role: 'Moves e2e to Depot runners, stacked on the cache PR.', refs: [prRef(clock, 41911, 1)] },
    ],
    userCares: [
      ...v2.userCares,
      {
        text: 'Storybook build time',
        source: 'observed',
        refs: [ref(clock, 'comment', 41855, 16, 'issuecomment-3')],
        userRefs: [userRef(clock, 'chat', '7', 15, 'Storybook going cold on every PR hurts.')],
      },
    ],
    recentChanges: [
      { at: clock.hoursAgo(0.3), text: 'lyra asked on #41902 whether the cache warm-up needs a flag.', refs: [ref(clock, 'comment', 41902, 0.3, 'issuecomment-2')] },
      { at: clock.hoursAgo(1), text: '#41911 opened: e2e moves to Depot runners, stacked on the cache PR.', refs: [ref(clock, 'pr', 41911, 1)] },
      { at: clock.hoursAgo(5), text: '#41902 opened: Turbo remote cache moves to Depot. CI fails on the warm-up job.', refs: [ref(clock, 'pr', 41902, 5)] },
      { at: clock.hoursAgo(14), text: 'Storybook turned its Turbo cache off in #41855 (Frontend build).', refs: [ref(clock, 'pr', 41855, 14)] },
      ...v2.recentChanges,
    ],
  };
}

function frontendDossierV1(clock: SampleClock): Dossier {
  return {
    goal: 'Upgrade the frontend build to Vite 7 without slowing CI.',
    summary: 'Vite 7 upgrade in review. Storybook snapshots went stale.',
    status: 'active',
    statusNote: 'Waiting on review of the upgrade.',
    people: [{ login: 'lyra', role: 'driver', note: 'Runs the Vite 7 upgrade.' }],
    openQuestions: [],
    timeline: [],
    earlier: 'The Vite 7 upgrade PR itself is outside what you get notified about.',
    userCares: [{ text: 'Only cache changes', source: 'tailoring' }],
    recentChanges: [{ at: clock.hoursAgo(30), text: '#41855 opened: skip the Turbo remote cache for Storybook.', refs: [ref(clock, 'pr', 41855, 30)] }],
  };
}

function frontendDossierV2(clock: SampleClock): Dossier {
  const v1 = frontendDossierV1(clock);
  return {
    ...v1,
    summary: 'Storybook runs without the Turbo cache now. The Vite 7 upgrade is still in review.',
    people: [...v1.people, { login: 'jude', role: 'contributor', note: 'Turned the Storybook cache off.' }],
    openQuestions: [
      { text: 'Are the Storybook snapshots stale because of the cache or the Vite upgrade?', askedBy: 'jude', refs: [ref(clock, 'comment', 41855, 16, 'issuecomment-3')] },
    ],
    timeline: [{ prKey: sampleKey(41855), role: 'Skips the Turbo remote cache for Storybook.' }],
    recentChanges: [
      { at: clock.hoursAgo(14), text: 'Storybook cache turned off (#41855 merged), every PR runs it cold.', refs: [ref(clock, 'pr', 41855, 14)] },
      ...v1.recentChanges,
    ],
  };
}

function version(topicId: string, number: number, dossier: Dossier, createdAt: string): DossierVersion {
  return { topicId, version: number, dossier, flags: [], inputHash: `sample-${topicId}-${number}`, throughSeq: 0, model: 'sample', createdAt };
}

function buildDossiers(clock: SampleClock): Map<string, DossierVersion[]> {
  return new Map([
    [
      DEPOT,
      [
        version(DEPOT, 1, depotDossierV1(clock), clock.hoursAgo(140)),
        version(DEPOT, 2, depotDossierV2(clock), clock.hoursAgo(22)),
        version(DEPOT, 3, depotDossierV3(clock), clock.hoursAgo(0.2)),
      ],
    ],
    [
      FRONTEND,
      [
        version(FRONTEND, 1, frontendDossierV1(clock), clock.hoursAgo(30)),
        version(FRONTEND, 2, frontendDossierV2(clock), clock.hoursAgo(13)),
      ],
    ],
  ]);
}

function buildFacts(clock: SampleClock): Fact[] {
  const facts = [
    sampleFact(clock, {
      id: 'fact-rowan-drives', subject: person('rowan'), predicate: 'drives', object: { kind: 'initiative', key: DEPOT },
      text: 'rowan drives the move to Depot.', topicId: DEPOT, recordedHoursAgo: 140,
      refs: [ref(clock, 'pr', 41851, 170), ref(clock, 'pr', 41902, 5)],
    }),
    sampleFact(clock, {
      id: 'fact-41902-part-of', subject: pr(41902), predicate: 'part_of', object: { kind: 'initiative', key: DEPOT },
      text: '#41902 is the Turbo cache layer of the Depot move.', topicId: DEPOT, recordedHoursAgo: 4,
      refs: [ref(clock, 'pr', 41902, 5)],
    }),
    sampleFact(clock, {
      id: 'fact-lyra-reviews-41902', subject: person('lyra'), predicate: 'reviews', object: pr(41902),
      text: 'lyra reviews #41902 and approved it.', topicId: DEPOT, recordedHoursAgo: 1,
      refs: [ref(clock, 'review', 41902, 1, 'review-41902-0')],
    }),
    sampleFact(clock, {
      id: 'fact-41902-status', subject: pr(41902), predicate: 'status', object: null,
      text: 'The warm-up job fails on the first cold run.', topicId: DEPOT, recordedHoursAgo: 4,
      refs: [{ ...ref(clock, 'commit', 41902, 4, 'a1b2c3'), headOid: 'a1b2c3' }],
    }),
    sampleFact(clock, {
      id: 'fact-41911-depends', subject: pr(41911), predicate: 'depends_on', object: pr(41902),
      text: '#41911 is stacked on #41902 and lands after it.', topicId: DEPOT, recordedHoursAgo: 0.9,
      refs: [ref(clock, 'pr', 41911, 1)],
    }),
    sampleFact(clock, {
      id: 'fact-nell-reviews-41911', subject: person('nell'), predicate: 'reviews', object: pr(41911),
      text: 'nell is asked to review #41911.', topicId: DEPOT, recordedHoursAgo: 0.9,
      refs: [ref(clock, 'pr', 41911, 1)],
    }),
    sampleFact(clock, {
      id: 'fact-41915-decided', subject: pr(41915), predicate: 'decided', object: null,
      text: 'DEPOT_TOKEN stays a repo secret for now; moving to the org secret comes later.', topicId: DEPOT, recordedHoursAgo: 24,
      refs: [ref(clock, 'comment', 41915, 25, 'issuecomment-4')],
    }),
    sampleFact(clock, {
      id: 'fact-lyra-owns-workflows', subject: person('lyra'), predicate: 'owns', object: { kind: 'path', key: `${SAMPLE_REPO}:.github/workflows/` },
      text: 'lyra owns the CI workflow files.', topicId: DEPOT, recordedHoursAgo: 48,
      refs: [ref(clock, 'review', 41899, 30, 'review-41899-1'), ref(clock, 'review', 41862, 80, 'review-41862-1')],
    }),
    sampleFact(clock, {
      id: 'fact-41855-cold', subject: pr(41855), predicate: 'note', object: null,
      text: 'Storybook runs cold on every PR since #41855.', topicId: FRONTEND, recordedHoursAgo: 13,
      refs: [ref(clock, 'pr', 41855, 14)],
    }),
  ];
  // The head of #41902 moved since the status fact was made, so verify-before-use flags it.
  const stale = facts.find((fact) => fact.id === 'fact-41902-status')!;
  stale.staleAt = clock.hoursAgo(0.5);
  stale.staleReason = 'head_moved';
  return facts;
}

function buildFeedback(clock: SampleClock): Feedback[] {
  const notMine = (id: number, number: number, hoursAgo: number): Feedback => ({
    id,
    kind: 'not_mine',
    topicId: 'topic-dependency-bumps',
    tileId: `pr:${sampleKey(number)}`,
    prKey: sampleKey(number),
    setId: null,
    eventId: null,
    note: 'bot bump',
    createdAt: clock.hoursAgo(hoursAgo),
  });
  return [notMine(1, 41640, 300), notMine(2, 41702, 200), notMine(3, 41755, 120), notMine(4, 41810, 50)];
}

function buildRuleProposals(clock: SampleClock): RuleProposal[] {
  return [
    {
      id: 'rule-bot-bumps',
      text: 'Do not surface Renovate or Dependabot bumps unless they touch CI config or cache hashing.',
      topicId: null,
      evidenceFeedbackIds: [1, 2, 3, 4],
      reason: 'You said "not mine" on 4 bot bump PRs in the last two weeks.',
      status: 'pending',
      createdAt: clock.hoursAgo(2),
      decidedAt: null,
    },
  ];
}

function buildNextRuleProposals(clock: SampleClock): RuleProposal[] {
  return [
    {
      id: 'rule-ci-limits',
      text: 'Put any PR that raises a CI timeout or retry count at the top.',
      topicId: CI,
      evidenceFeedbackIds: [],
      reason: 'The topic tailoring and two chats asked for loosened limits first.',
      status: 'pending',
      createdAt: clock.hoursAgo(0),
      decidedAt: null,
    },
  ];
}

function buildSeen(clock: SampleClock): Map<string, Cursor> {
  const at = clock.hoursAgo(20);
  return new Map([[DEPOT, { kind: 'seen', scope: DEPOT, seq: 0, dossierVersion: 2, updatedAt: at }]]);
}

export function buildSampleMemory(now: Date): SampleMemory {
  const clock = new SampleClock(now);
  return {
    dossiers: buildDossiers(clock),
    facts: buildFacts(clock),
    ruleProposals: buildRuleProposals(clock),
    nextRuleProposals: buildNextRuleProposals(clock),
    seen: buildSeen(clock),
    feedback: buildFeedback(clock),
  };
}
