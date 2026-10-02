// A board recipe for property tests: plain data that fast-check generates and
// shrinks. `buildBoard` turns it into PR snapshots, events and tiles through
// the same core functions the store and the engine use, so every generated
// board is shaped like real data. Names and repos are invented (acme/app,
// alice, ada, lyra, rowan; renovate is the one automation account without
// the [bot] suffix, acme-agent[bot] the coding agent that opens PRs for
// people).
import fc from 'fast-check';
import type { TopicRelation } from '../memory.ts';
import type { NotificationReason, Verdict } from '../types.ts';

/**
 * Who does something: the viewer, a teammate (lyra), someone outside the
 * team (ada, and alice as a second outsider), a GitHub App (dependabot[bot])
 * or automation on a user account without the [bot] suffix (renovate).
 * Only PR authors: a coding agent's GitHub App (acme-agent[bot]) and a
 * deleted account (ghost, read as '').
 */
export type Person = 'viewer' | 'teammate' | 'other' | 'outsider' | 'bot' | 'app' | 'agent' | 'ghost';

/** Who a PR is assigned to: the viewer, a teammate (lyra) or ada. A bot's PR belongs to its assignees (DESIGN "PR ownership"). */
export type Assignee = 'viewer' | 'teammate' | 'other';

/**
 * Whom a review request names: the viewer, the viewer's team
 * (team-platform), another team (team-infra), the approvers team (the
 * viewer's routing team on most boards that have it), a teammate (rowan),
 * or ada (so the reviewer who asked for changes gets asked again).
 */
export type RequestTarget = 'viewer' | 'team' | 'other_team' | 'routing_team' | 'teammate' | 'other';

/** What a comment says, as far as the rules care. routing_mention names approvers, teams_mention approvers and team-platform. */
export type CommentText = 'plain' | 'mention' | 'question' | 'team_mention' | 'routing_mention' | 'teams_mention' | 'bot_marker' | 'deploy';

/**
 * The viewer's teams and their roles (DESIGN "Team roles"). one_home:
 * team-platform, a home team. home_and_routing: team-platform home,
 * approvers routing only. no_home: both routing only, so no teammates.
 * undecided: both teams, roles not decided yet (`homeTeams` missing), so
 * both count as home.
 */
export type TeamSetup = 'one_home' | 'home_and_routing' | 'no_home' | 'undecided';

/** PENDING: an unsent review, which says nothing yet. */
export type ReviewVerdict = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

/** Automation on the timeline: the merge queue took the PR or dropped it, or a deploy ran. */
export type AutomationItem = 'queued' | 'unqueued' | 'deployed';

/**
 * What trunk-io[bot] says about its merge queue (DESIGN "Merge queue"):
 * the merge offer, submitted, testing (a PR, or a stack on a stack layer),
 * failed (tests), failed in a wording only its ❌ tells, cancelled by a
 * user, merged, or a line nobody knows.
 */
export type TrunkText = 'offer' | 'submitted' | 'testing' | 'stack_testing' | 'failed' | 'emoji_failed' | 'cancelled' | 'merged' | 'garbage';

/** One thing that happened on the PR, in order. Steps GitHub would not allow are skipped when the PR is built. */
export type StepSpec =
  | { kind: 'request'; target: RequestTarget; byBot: boolean }
  | { kind: 'unrequest'; target: RequestTarget }
  /** GitHub's re-request button: ask every reviewer whose changes request stands again. */
  | { kind: 'rerequest' }
  | { kind: 'comment'; by: Person; text: CommentText; thread: 0 | 1 | null }
  /**
   * Edit an earlier comment or review body (the one at `pick`, modulo the
   * comments so far; skipped when there is none): by its author (a bot
   * updating its sticky comment, a person fixing a typo) or by someone
   * else. `text` is the new body; null keeps it.
   */
  | { kind: 'edit'; pick: number; by: Person | 'author'; text: CommentText | null }
  /** `body`: the review's text, shown as a comment of kind review (none when left out). */
  | { kind: 'review'; by: Person; state: ReviewVerdict; body?: CommentText | null }
  | { kind: 'push'; by: Person; force: boolean }
  | { kind: 'ready' }
  | { kind: 'to_draft' }
  | { kind: 'automation'; item: AutomationItem }
  /** Trunk says `text`: edits its first comment on the PR when `sticky` and it has one, else posts a new comment. */
  | { kind: 'trunk'; text: TrunkText; sticky: boolean };

export type EndSpec = { kind: 'open' } | { kind: 'merged'; by: Person } | { kind: 'closed'; by: Person };

export type CiSpec = 'none' | 'pending' | 'success' | 'failure';

/**
 * How the app knows the PR: a notification thread (read after `readAfter`
 * steps, null for never), found by the full sync, or pulled in as a stack or
 * set layer.
 */
export type TrackingSpec = { kind: 'thread'; reason: NotificationReason; readAfter: number | null } | { kind: 'found' } | { kind: 'pulled_in' };

export type SnoozeConditionKind = 'someone_replies' | 'new_push' | 'ci_green' | 'until_time';

/** A snooze started after `after` steps; an until_time snooze has passed or not. */
export interface SnoozeSpec {
  condition: SnoozeConditionKind;
  after: number;
  untilPassed: boolean;
}

/** An agent override on the event at `pick` (modulo the PR's event count). */
export interface OverrideSpec {
  pick: number;
  loudness: 'loud' | 'quiet' | 'muted';
}

/** How the glance's risk line starts: a level the agent can back an action at, high, or a word nobody can read as a level. */
export type RiskWord = 'low' | 'medium' | 'high' | 'garbage';

export interface PrSpec {
  author: Person;
  /** In this order; the first names the owner in sentences when a bot opened the PR. */
  assignees: Assignee[];
  /** Opened as a draft. */
  draft: boolean;
  steps: StepSpec[];
  end: EndSpec;
  ci: CiSpec;
  tracking: TrackingSpec;
  /** The unresolved review threads are resolved. */
  threadsResolved: boolean;
  /** Approved in the app after this many steps, null for never. */
  approvedAfter: number | null;
  /** Marked read in the app (the button) after this many steps, null for never. */
  markedReadAfter: number | null;
  snooze: SnoozeSpec | null;
  glance: Verdict | null;
  /** How the glance's risk line starts (`RISK_LINES`). Ignored without a glance. */
  glanceRisk: RiskWord;
  /** The PR, instructions or feedback moved since the glance was made (`glanceStale`). Ignored without a glance. */
  glanceStale: boolean;
  /** The Look closer ping fired for a routed team request (only kept when `lookCloserPingCheck` agrees). */
  lookCloser: boolean;
  overrides: OverrideSpec[];
  /**
   * The events agent judged the unseen quiet activity of people (not asks)
   * and left it quiet, as it does for news on unread threads (DESIGN.md
   * "GitHub unread is PostPile unread"): each such event gets a quiet
   * override. `overrides` apply after it.
   */
  judged: boolean;
  /** The snapshot was cut off at the query's caps. */
  truncated: boolean;
  /** The snapshot is older than the thread's last update. */
  staleSnapshot: boolean;
  /** A mark-read of this PR waits for the writes lock (kept only while the lock is on and the thread is unread). */
  pendingWrite: boolean;
}

/** A scenario's starting point: ada's open PR, pinged for a review request, with nothing else going on. */
export const QUIET_PR: PrSpec = {
  author: 'other',
  assignees: [],
  draft: false,
  steps: [],
  end: { kind: 'open' },
  ci: 'none',
  tracking: { kind: 'thread', reason: 'review_requested', readAfter: null },
  threadsResolved: false,
  approvedAfter: null,
  markedReadAfter: null,
  snooze: null,
  glance: null,
  glanceRisk: 'low',
  glanceStale: false,
  lookCloser: false,
  overrides: [],
  judged: false,
  truncated: false,
  staleSnapshot: false,
  pendingWrite: false,
};

/**
 * single, stack and set: a single PR, a real stack (by base and head
 * branches) or an agent set. set_with_stack: a set whose first two PRs are
 * a stack, and the set lists only the upper layer (the set brings the whole
 * stack along). dissolved_set: a set the agent dissolved, so its PRs show
 * on their own.
 */
export type GroupKind = 'single' | 'stack' | 'set' | 'set_with_stack' | 'dissolved_set';

/** One tile to be (or, for a dissolved set, the PRs that were one). */
export interface GroupSpec {
  kind: GroupKind;
  prs: PrSpec[];
  /**
   * The whole tile snoozed (`snoozeWrites`), replacing the PRs' own snoozes;
   * `after` counts ten-minute blocks back from the board's last activity.
   */
  snooze: SnoozeSpec | null;
}

/**
 * The topic itself, for its sidebar section (DESIGN "Ownership sections"):
 * who drives it (null: nobody known), and its dossier's relation and owner
 * team. relation null: no dossier yet, so no owner team either. Owner home
 * is team-platform, routing the approvers team (home only while roles are
 * undecided), other team-infra.
 */
export interface TopicSpec {
  driver: 'viewer' | 'teammate' | 'other' | 'outsider' | null;
  relation: TopicRelation | null;
  ownerTeam: 'home' | 'routing' | 'other' | null;
}

/** A topic nothing places: no driver known, no dossier yet. */
export const UNSORTED_TOPIC: TopicSpec = { driver: null, relation: null, ownerTeam: null };

export interface BoardSpec {
  groups: GroupSpec[];
  topic: TopicSpec;
  teams: TeamSetup;
  /** GitHub writes are locked, so mark-reads wait as pending writes. */
  writesLocked: boolean;
  /** The team member list was never fetched, so rules fall back to "any other reviewer is a teammate". */
  teamMembersUnknown: boolean;
  /** Minutes from the last activity to now. */
  nowGap: number;
}

/** True in `yes` of `yes + no` cases; shrinks to false. */
function sometimes(yes: number, no: number): fc.Arbitrary<boolean> {
  return fc.oneof({ weight: no, arbitrary: fc.constant(false) }, { weight: yes, arbitrary: fc.constant(true) });
}

/** A value in `percent` of cases, else null; shrinks to null. */
function maybe<T>(arbitrary: fc.Arbitrary<T>, percent: number): fc.Arbitrary<T | null> {
  return fc.oneof({ weight: 100 - percent, arbitrary: fc.constant(null) }, { weight: percent, arbitrary });
}

/** Who acts: the viewer and ada most, since most rules turn on what the viewer did and what others asked. */
const person: fc.Arbitrary<Person> = fc.oneof(
  { weight: 6, arbitrary: fc.constant<Person>('other') },
  { weight: 6, arbitrary: fc.constant<Person>('viewer') },
  { weight: 2, arbitrary: fc.constant<Person>('teammate') },
  { weight: 1, arbitrary: fc.constant<Person>('outsider') },
  { weight: 2, arbitrary: fc.constant<Person>('bot') },
  { weight: 1, arbitrary: fc.constant<Person>('app') },
);
/** Mostly people and dependabot; now and then a coding agent's PR or a deleted author, which the assignees own. */
const author: fc.Arbitrary<Person> = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom<Person>('other', 'viewer', 'teammate', 'bot') },
  { weight: 1, arbitrary: fc.constant<Person>('app') },
  { weight: 2, arbitrary: fc.constant<Person>('agent') },
  { weight: 1, arbitrary: fc.constant<Person>('ghost') },
);
/** Half the PRs have nobody assigned; the rest one person, or two with the viewer or a teammate second. */
const assignees: fc.Arbitrary<Assignee[]> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Assignee[]>([]) },
  { weight: 3, arbitrary: fc.constantFrom<Assignee[]>(['viewer'], ['teammate'], ['other']) },
  { weight: 1, arbitrary: fc.constantFrom<Assignee[]>(['teammate', 'viewer'], ['other', 'teammate']) },
);
const nonViewer = fc.constantFrom<Person>('other', 'teammate', 'bot');
/** The viewer and their team most: those requests are what the rules act on. */
const target: fc.Arbitrary<RequestTarget> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom<RequestTarget>('viewer', 'team', 'routing_team') },
  { weight: 1, arbitrary: fc.constantFrom<RequestTarget>('other_team', 'teammate', 'other') },
);
const commentText = fc.constantFrom<CommentText>('plain', 'mention', 'question', 'team_mention', 'routing_mention', 'teams_mention', 'bot_marker', 'deploy');
const stepIndex = fc.nat({ max: 8 });

const stepArb: fc.Arbitrary<StepSpec> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('request' as const), target, byBot: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unrequest' as const), target }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'rerequest' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('comment' as const),
      by: person,
      text: commentText,
      thread: fc.constantFrom<0 | 1 | null>(null, 0, 1),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('review' as const),
      by: person,
      state: fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom<ReviewVerdict>('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED') },
        { weight: 1, arbitrary: fc.constant<ReviewVerdict>('PENDING') },
      ),
      body: maybe(commentText, 25),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('edit' as const),
      pick: stepIndex,
      by: fc.oneof({ weight: 3, arbitrary: fc.constant<'author'>('author') }, { weight: 1, arbitrary: person }),
      text: maybe(commentText, 60),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('push' as const), by: person, force: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'ready' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'to_draft' as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('automation' as const), item: fc.constantFrom<AutomationItem>('queued', 'unqueued', 'deployed') }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('trunk' as const),
      // Failures most: a loud one needs the viewer's own open PR as well.
      text: fc.oneof(
        { weight: 3, arbitrary: fc.constant<TrunkText>('failed') },
        { weight: 2, arbitrary: fc.constantFrom<TrunkText>('submitted', 'testing', 'stack_testing', 'emoji_failed') },
        { weight: 1, arbitrary: fc.constantFrom<TrunkText>('offer', 'cancelled', 'merged', 'garbage') },
      ),
      sticky: fc.boolean(),
    }),
  },
);

const endArb: fc.Arbitrary<EndSpec> = fc.oneof(
  { weight: 6, arbitrary: fc.constant({ kind: 'open' as const }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('merged' as const), by: nonViewer }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('merged' as const), by: fc.constant<Person>('viewer') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('closed' as const), by: person }) },
);

const trackingArb: fc.Arbitrary<TrackingSpec> = fc.oneof(
  {
    weight: 7,
    arbitrary: fc.record({
      kind: fc.constant('thread' as const),
      reason: fc.constantFrom<NotificationReason>('review_requested', 'mention', 'team_mention', 'author', 'comment', 'subscribed', 'state_change'),
      readAfter: maybe(stepIndex, 60),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'found' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'pulled_in' as const }) },
);

const snoozeArb: fc.Arbitrary<SnoozeSpec> = fc.record({
  condition: fc.constantFrom<SnoozeConditionKind>('until_time', 'someone_replies', 'new_push', 'ci_green'),
  after: stepIndex,
  untilPassed: fc.boolean(),
});

/** One PR with a short, valid history. Small numbers and short lists, so shrinking ends on a readable case. */
export const prSpecArb: fc.Arbitrary<PrSpec> = fc.record({
  author,
  assignees,
  draft: sometimes(1, 4),
  steps: fc.array(stepArb, { maxLength: 8 }),
  end: endArb,
  ci: fc.constantFrom<CiSpec>('none', 'success', 'failure', 'pending'),
  tracking: trackingArb,
  threadsResolved: fc.boolean(),
  approvedAfter: maybe(stepIndex, 20),
  markedReadAfter: maybe(stepIndex, 35),
  snooze: maybe(snoozeArb, 15),
  glance: maybe(fc.constantFrom<Verdict>('LOOKS_SAFE', 'LOOK_CLOSER', 'NOT_YOURS'), 60),
  glanceRisk: fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom<RiskWord>('low', 'medium') },
    { weight: 1, arbitrary: fc.constantFrom<RiskWord>('high', 'garbage') },
  ),
  glanceStale: sometimes(1, 4),
  lookCloser: sometimes(3, 1),
  overrides: fc.array(fc.record({ pick: fc.nat({ max: 20 }), loudness: fc.constantFrom<OverrideSpec['loudness']>('quiet', 'loud', 'muted') }), { maxLength: 2 }),
  judged: sometimes(1, 1),
  truncated: sometimes(1, 6),
  staleSnapshot: sometimes(1, 6),
  pendingWrite: fc.boolean(),
});

function groupArb(kind: GroupKind, minLength: number, maxLength: number): fc.Arbitrary<GroupSpec> {
  return fc.record({
    kind: fc.constant(kind),
    prs: fc.array(prSpecArb, { minLength, maxLength }),
    snooze: maybe(snoozeArb, 25),
  });
}

/**
 * A PR asking the viewer for a review, so the pane leads with Approve:
 * ada's open PR with a request for the viewer and a glance that is mostly
 * Looks safe, now and then a draft, stale, missing or at any risk word.
 * Stacks of these mix covered, blocking and draft layers, the shapes the
 * agent Approve's base-up rule branches on (owner, 2026-10-01).
 */
const reviewPrSpecArb: fc.Arbitrary<PrSpec> = fc
  .record({
    draft: sometimes(1, 4),
    glance: fc.oneof(
      { weight: 5, arbitrary: fc.constant<Verdict | null>('LOOKS_SAFE') },
      { weight: 2, arbitrary: fc.constant<Verdict | null>('LOOK_CLOSER') },
      { weight: 1, arbitrary: fc.constant<Verdict | null>(null) },
    ),
    glanceRisk: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom<RiskWord>('low', 'medium') },
      { weight: 1, arbitrary: fc.constantFrom<RiskWord>('high', 'garbage') },
    ),
    glanceStale: sometimes(1, 7),
  })
  .map((picked) => ({ ...QUIET_PR, steps: [{ kind: 'request' as const, target: 'viewer' as const, byBot: false }], ...picked }));

/** Mostly a stack of review PRs, sometimes the same inside a set. */
const reviewGroupArb: fc.Arbitrary<GroupSpec> = fc.record({
  kind: fc.constantFrom<GroupKind>('stack', 'stack', 'stack', 'set_with_stack', 'set'),
  prs: fc.array(reviewPrSpecArb, { minLength: 2, maxLength: 4 }),
  snooze: maybe(snoozeArb, 10),
});

const anyGroupArb: fc.Arbitrary<GroupSpec> = fc.oneof(
  { weight: 6, arbitrary: groupArb('single', 1, 1) },
  { weight: 3, arbitrary: reviewGroupArb },
  { weight: 4, arbitrary: groupArb('stack', 2, 4) },
  { weight: 4, arbitrary: groupArb('set', 2, 4) },
  { weight: 1, arbitrary: groupArb('set_with_stack', 2, 4) },
  { weight: 1, arbitrary: groupArb('dissolved_set', 2, 3) },
);

/** Every driver, relation and owner team, a missing one as often as any other. */
const topicSpecArb: fc.Arbitrary<TopicSpec> = fc.record({
  driver: fc.constantFrom<TopicSpec['driver']>(null, 'viewer', 'teammate', 'other', 'outsider'),
  relation: fc.constantFrom<TopicSpec['relation']>(null, 'team', 'routed', 'fyi'),
  ownerTeam: fc.constantFrom<TopicSpec['ownerTeam']>(null, 'home', 'routing', 'other'),
});

/** A board: one topic with one to three tiles, 1-4 PRs each. */
export const boardSpecArb: fc.Arbitrary<BoardSpec> = fc.record({
  groups: fc.array(anyGroupArb, { minLength: 1, maxLength: 3 }),
  topic: topicSpecArb,
  teams: fc.constantFrom<TeamSetup>('one_home', 'home_and_routing', 'no_home', 'undecided'),
  writesLocked: fc.boolean(),
  teamMembersUnknown: sometimes(1, 9),
  nowGap: fc.constantFrom(5000, 60, 3),
});
