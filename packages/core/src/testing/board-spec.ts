// A board recipe for property tests: plain data that fast-check generates and
// shrinks. `buildBoard` turns it into PR snapshots, events and tiles through
// the same core functions the store and the engine use, so every generated
// board is shaped like real data. Names and repos are invented (acme/app,
// alice, ada, lyra, rowan).
import fc from 'fast-check';
import type { NotificationReason, Verdict } from '../types.ts';

/** Who does something: the viewer, a teammate (lyra), someone outside the team (ada) or a bot. */
export type Person = 'viewer' | 'teammate' | 'other' | 'bot';

/** Whom a review request names: the viewer, the viewer's team, another team, or a teammate (rowan). */
export type RequestTarget = 'viewer' | 'team' | 'other_team' | 'teammate';

/** What a comment says, as far as the rules care. */
export type CommentText = 'plain' | 'mention' | 'question' | 'team_mention' | 'bot_marker';

export type ReviewVerdict = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

/** One thing that happened on the PR, in order. Steps GitHub would not allow are skipped when the PR is built. */
export type StepSpec =
  | { kind: 'request'; target: RequestTarget; byBot: boolean }
  | { kind: 'unrequest'; target: RequestTarget }
  | { kind: 'comment'; by: Person; text: CommentText; thread: 0 | 1 | null }
  | { kind: 'review'; by: Person; state: ReviewVerdict }
  | { kind: 'push'; by: Person; force: boolean }
  | { kind: 'ready' }
  | { kind: 'to_draft' };

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

export interface PrSpec {
  author: Person;
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
  /** The Look closer ping fired for a routed team request (only kept when `lookCloserPingCheck` agrees). */
  lookCloser: boolean;
  overrides: OverrideSpec[];
  /** The snapshot was cut off at the query's caps. */
  truncated: boolean;
  /** The snapshot is older than the thread's last update. */
  staleSnapshot: boolean;
  /** A mark-read of this PR waits for the writes lock (kept only while the lock is on and the thread is unread). */
  pendingWrite: boolean;
}

export type GroupKind = 'single' | 'stack' | 'set';

/** One tile to be: a single PR, a real stack (by base and head branches) or an agent set. */
export interface GroupSpec {
  kind: GroupKind;
  prs: PrSpec[];
  /**
   * The whole tile snoozed (`snoozeWrites`), replacing the PRs' own snoozes;
   * `after` counts ten-minute blocks back from the board's last activity.
   */
  snooze: SnoozeSpec | null;
}

export interface BoardSpec {
  groups: GroupSpec[];
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
  { weight: 3, arbitrary: fc.constant<Person>('other') },
  { weight: 3, arbitrary: fc.constant<Person>('viewer') },
  { weight: 1, arbitrary: fc.constant<Person>('teammate') },
  { weight: 1, arbitrary: fc.constant<Person>('bot') },
);
const nonViewer = fc.constantFrom<Person>('other', 'teammate', 'bot');
const target = fc.constantFrom<RequestTarget>('viewer', 'team', 'other_team', 'teammate');
const stepIndex = fc.nat({ max: 8 });

const stepArb: fc.Arbitrary<StepSpec> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('request' as const), target, byBot: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unrequest' as const), target }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('comment' as const),
      by: person,
      text: fc.constantFrom<CommentText>('plain', 'mention', 'question', 'team_mention', 'bot_marker'),
      thread: fc.constantFrom<0 | 1 | null>(null, 0, 1),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('review' as const),
      by: person,
      state: fc.constantFrom<ReviewVerdict>('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('push' as const), by: person, force: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'ready' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'to_draft' as const }) },
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
  author: fc.constantFrom<Person>('other', 'viewer', 'teammate', 'bot'),
  draft: sometimes(1, 4),
  steps: fc.array(stepArb, { maxLength: 8 }),
  end: endArb,
  ci: fc.constantFrom<CiSpec>('none', 'success', 'failure', 'pending'),
  tracking: trackingArb,
  threadsResolved: fc.boolean(),
  approvedAfter: maybe(stepIndex, 20),
  markedReadAfter: maybe(stepIndex, 35),
  snooze: maybe(snoozeArb, 15),
  glance: maybe(fc.constantFrom<Verdict>('LOOKS_SAFE', 'LOOK_CLOSER', 'NOT_YOURS'), 50),
  lookCloser: sometimes(3, 1),
  overrides: fc.array(fc.record({ pick: fc.nat({ max: 20 }), loudness: fc.constantFrom<OverrideSpec['loudness']>('quiet', 'loud', 'muted') }), { maxLength: 2 }),
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

const anyGroupArb: fc.Arbitrary<GroupSpec> = fc.oneof(
  { weight: 3, arbitrary: groupArb('single', 1, 1) },
  { weight: 2, arbitrary: groupArb('stack', 2, 4) },
  { weight: 2, arbitrary: groupArb('set', 2, 4) },
);

/** A board: one topic with one to three tiles, 1-4 PRs each. */
export const boardSpecArb: fc.Arbitrary<BoardSpec> = fc.record({
  groups: fc.array(anyGroupArb, { minLength: 1, maxLength: 3 }),
  writesLocked: fc.boolean(),
  teamMembersUnknown: sometimes(1, 9),
  nowGap: fc.constantFrom(5000, 60, 3),
});
