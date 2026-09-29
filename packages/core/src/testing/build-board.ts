// Turns a `BoardSpec` into the data the engine's Board holds, and tile views
// like the read models build them. PR snapshots are compiled from the steps;
// events come from `deriveEvents` and turn seen the way the sync does it
// (GitHub's read time, the viewer's own events on a read thread, the last
// touch) and the way the app does it (`planRead`). Tiles come from
// `buildTopicTiles`, a tile snooze from `snoozeWrites`. Nothing here sets a
// rule's answer by hand.
import { eventsSeenByTouch } from '../last-touch.ts';
import { at, makePr } from '../fixtures.ts';
import { deriveEvents } from '../events.ts';
import { ownEventsOnReadThread } from '../github-read.ts';
import { lookCloserEvent, lookCloserPingCheck } from '../glance-pings.ts';
import { prKey } from '../keys.ts';
import { sameLogin } from '../mentions.ts';
import { isTracked } from '../provenance.ts';
import { applyReadPlan, planRead, prReadScope, type ReadCause } from '../read-plan.ts';
import { snoozeWrites } from '../snooze.ts';
import { buildStacks } from '../stacks.ts';
import { buildTopicTiles, deriveTileState } from '../tiles.ts';
import { buildPrSummary, buildTileView } from '../tile-view.ts';
import type {
  Comment,
  Commit,
  FoundPr,
  IsoTime,
  NotificationThread,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  Review,
  ReviewDecision,
  ReviewThread,
  Snooze,
  SnoozeCondition,
  Tile,
  TileState,
  TimelineItem,
  UserPrState,
  Verdict,
  Viewer,
} from '../types.ts';
import type { PrSummary, TilePendingWrite, TileView } from '../views.ts';
import type { BoardSpec, CommentText, Person, PrSpec, RequestTarget, SnoozeSpec, StepSpec } from './board-spec.ts';

export const PROPERTY_REPO = 'acme/app';
export const PROPERTY_TOPIC_ID = 'topic-1';
export const PROPERTY_TEAM = 'acme/team-platform';
export const OTHER_TEAM = 'acme/team-infra';
/** Who makes a bot's review request. */
export const REQUEST_BOT = 'github-actions[bot]';

export const LOGINS: Record<Person, string> = { viewer: 'viewer', teammate: 'lyra', other: 'ada', bot: 'dependabot[bot]' };

/** The login or team a request target names; the teammate asked is rowan, so lyra can still be the author. */
export function requestSubject(target: RequestTarget): string {
  switch (target) {
    case 'viewer':
      return LOGINS.viewer;
    case 'team':
      return PROPERTY_TEAM;
    case 'other_team':
      return OTHER_TEAM;
    case 'teammate':
      return 'rowan';
  }
}

export function propertyViewer(spec: Pick<BoardSpec, 'teamMembersUnknown'>): Viewer {
  const viewer: Viewer = { login: LOGINS.viewer, teams: [PROPERTY_TEAM] };
  return spec.teamMembersUnknown ? viewer : { ...viewer, teamMembers: ['lyra', 'rowan'] };
}

const COMMENT_BODIES: Record<CommentText, string> = {
  plain: 'looks fine',
  mention: 'cc @viewer',
  question: '@viewer can you check the migration?',
  team_mention: 'cc @acme/team-platform',
  bot_marker: '<!-- bot --> automated comment: coverage went down',
};

/** Minute of step `index` (0-based) of the PR at `prIndex`: ten minutes apart, never on the same minute as another PR's. */
function stepMinute(prIndex: number, index: number): number {
  return 10 * (index + 1) + prIndex;
}

/** Minute right after the first `count` steps (0: before any step). */
function afterMinute(prIndex: number, count: number): number {
  return 10 * count + prIndex + 5;
}

/** A human who asks for a review: the author, or ada when a bot wrote the PR. */
function humanRequester(author: string): string {
  return author === LOGINS.bot ? LOGINS.other : author;
}

/** Builds one PR snapshot step by step, skipping what GitHub would not allow. */
class PrHistory {
  readonly comments: Comment[] = [];
  readonly reviews: Review[] = [];
  commits: Commit[];
  readonly timeline: TimelineItem[] = [];
  readonly reviewThreads = new Map<string, Comment[]>();
  readonly reviewerUsers: string[] = [];
  readonly reviewerTeams: string[] = [];
  isDraft: boolean;
  /** The head commit after each number of steps, so an in-app approval names what it approved. */
  readonly headAfter: string[] = [];

  constructor(
    readonly number: number,
    readonly author: string,
    draft: boolean,
  ) {
    this.commits = [{ oid: `c${number}-0`, headline: 'first', author, committer: author, committedAt: at(0) }];
    this.isDraft = draft;
    this.headAfter.push(this.headOid);
  }

  get headOid(): string {
    return this.commits[this.commits.length - 1]!.oid;
  }

  private id(prefix: string, index: number): string {
    return `${prefix}${this.number}-${index}`;
  }

  private request(step: Extract<StepSpec, { kind: 'request' }>, index: number, time: string): void {
    const subject = requestSubject(step.target);
    const pending = subject.includes('/') ? this.reviewerTeams : this.reviewerUsers;
    if (sameLogin(subject, this.author) || pending.includes(subject)) {
      return;
    }
    pending.push(subject);
    const actor = step.byBot ? REQUEST_BOT : humanRequester(this.author);
    this.timeline.push({ id: this.id('tl', index), kind: 'review_requested', actor, at: time, subject });
  }

  private unrequest(step: Extract<StepSpec, { kind: 'unrequest' }>, index: number, time: string): void {
    const subject = requestSubject(step.target);
    const pending = subject.includes('/') ? this.reviewerTeams : this.reviewerUsers;
    const position = pending.indexOf(subject);
    if (position < 0) {
      return;
    }
    pending.splice(position, 1);
    this.timeline.push({ id: this.id('tl', index), kind: 'review_request_removed', actor: humanRequester(this.author), at: time, subject });
  }

  private comment(step: Extract<StepSpec, { kind: 'comment' }>, index: number, time: string): void {
    const threadId = step.thread === null ? null : `rt${this.number}-${step.thread}`;
    const comment: Comment = {
      id: this.id('cm', index),
      author: LOGINS[step.by],
      body: COMMENT_BODIES[step.text],
      createdAt: time,
      kind: threadId === null ? 'comment' : 'review_comment',
      url: `https://github.com/${PROPERTY_REPO}/pull/${this.number}#comment-${index}`,
      path: threadId === null ? null : 'a.ts',
      threadId,
    };
    this.comments.push(comment);
    if (threadId !== null) {
      this.reviewThreads.set(threadId, [...(this.reviewThreads.get(threadId) ?? []), comment]);
    }
  }

  private review(step: Extract<StepSpec, { kind: 'review' }>, index: number, time: string): void {
    const login = LOGINS[step.by];
    // GitHub lets an author only comment on their own PR.
    const state = sameLogin(login, this.author) ? 'COMMENTED' : step.state;
    this.reviews.push({ id: this.id('rv', index), author: login, state, body: '', submittedAt: time, commitOid: this.headOid });
    const position = this.reviewerUsers.findIndex((user) => sameLogin(user, login));
    if (position >= 0) {
      this.reviewerUsers.splice(position, 1);
    }
  }

  private push(step: Extract<StepSpec, { kind: 'push' }>, index: number, time: string): void {
    const login = LOGINS[step.by];
    const commit: Commit = { oid: this.id('c', index + 1), headline: 'more work', author: login, committer: login, committedAt: time };
    if (step.force) {
      this.timeline.push({ id: this.id('tl', index), kind: 'head_ref_force_pushed', actor: login, at: time, subject: null });
      this.commits = [commit];
    } else {
      this.commits.push(commit);
    }
  }

  apply(step: StepSpec, index: number, time: string): void {
    switch (step.kind) {
      case 'request':
        this.request(step, index, time);
        break;
      case 'unrequest':
        this.unrequest(step, index, time);
        break;
      case 'comment':
        this.comment(step, index, time);
        break;
      case 'review':
        this.review(step, index, time);
        break;
      case 'push':
        this.push(step, index, time);
        break;
      case 'ready':
        if (this.isDraft) {
          this.isDraft = false;
          this.timeline.push({ id: this.id('tl', index), kind: 'ready_for_review', actor: this.author, at: time, subject: null });
        }
        break;
      case 'to_draft':
        if (!this.isDraft) {
          this.isDraft = true;
          this.timeline.push({ id: this.id('tl', index), kind: 'converted_to_draft', actor: this.author, at: time, subject: null });
        }
        break;
    }
    this.headAfter.push(this.headOid);
  }

  /** Like GitHub: the standing verdicts of everyone, a dismissed review counts for nothing. */
  reviewDecision(): ReviewDecision {
    const latest = new Map<string, Review>();
    for (const review of this.reviews) {
      if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
        latest.set(review.author.toLowerCase(), review);
      }
    }
    const states = [...latest.values()].map((review) => review.state);
    if (states.includes('CHANGES_REQUESTED')) {
      return 'CHANGES_REQUESTED';
    }
    return states.includes('APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED';
  }

  threads(resolved: boolean): ReviewThread[] {
    return [...this.reviewThreads.entries()].map(([id, comments]) => ({ id, path: 'a.ts', isResolved: resolved, comments }));
  }
}

/** Where the PR sits: number, branches and position in its group. */
interface PrPlace {
  prIndex: number;
  number: number;
  baseRef: string;
  headRef: string;
}

interface CompiledPr {
  pr: Pr;
  /** The head commit after each number of steps. */
  headAfter: string[];
  /** Last activity on GitHub (steps, merge or close, CI). */
  lastMinute: number;
}

function compilePr(spec: PrSpec, place: PrPlace): CompiledPr {
  const author = LOGINS[spec.author];
  const history = new PrHistory(place.number, author, spec.draft);
  spec.steps.forEach((step, index) => history.apply(step, index, at(stepMinute(place.prIndex, index))));
  const endMinute = stepMinute(place.prIndex, spec.steps.length);
  const ciMinute = afterMinute(place.prIndex, spec.steps.length) - 3;
  let state: Pr['state'] = 'OPEN';
  let mergedAt: string | null = null;
  let mergedBy: string | null = null;
  if (spec.end.kind === 'merged') {
    // Nobody merges a draft: it was marked ready first.
    if (history.isDraft) {
      history.isDraft = false;
      history.timeline.push({ id: `tl${place.number}-ready`, kind: 'ready_for_review', actor: author, at: at(endMinute - 1), subject: null });
    }
    state = 'MERGED';
    mergedAt = at(endMinute);
    mergedBy = LOGINS[spec.end.by];
    history.timeline.push({ id: `tl${place.number}-end`, kind: 'merged', actor: mergedBy, at: mergedAt, subject: null });
  } else if (spec.end.kind === 'closed') {
    state = 'CLOSED';
    history.timeline.push({ id: `tl${place.number}-end`, kind: 'closed', actor: LOGINS[spec.end.by], at: at(endMinute), subject: null });
  }
  const lastStepMinute = spec.steps.length === 0 ? 0 : stepMinute(place.prIndex, spec.steps.length - 1);
  const ciRan = spec.ci !== 'none';
  const lastMinute = Math.max(lastStepMinute, state === 'OPEN' ? 0 : endMinute, ciRan ? ciMinute : 0);
  const rollup = { none: 'NONE', pending: 'PENDING', success: 'SUCCESS', failure: 'FAILURE' } as const;
  const finished = spec.ci === 'success' || spec.ci === 'failure';
  const pr = makePr({
    number: place.number,
    repo: PROPERTY_REPO,
    author,
    state,
    isDraft: history.isDraft,
    baseRef: place.baseRef,
    headRef: place.headRef,
    reviewDecision: history.reviewDecision(),
    reviewerUsers: [...history.reviewerUsers],
    reviewerTeams: [...history.reviewerTeams],
    reviews: history.reviews,
    commits: history.commits,
    comments: history.comments,
    threads: history.threads(spec.threadsResolved),
    timeline: history.timeline,
    checks: {
      rollup: rollup[spec.ci],
      contexts: ciRan ? [{ name: 'ci', conclusion: finished ? spec.ci.toUpperCase() : null, completedAt: finished ? at(ciMinute) : null }] : [],
    },
    headOid: history.headOid,
    createdAt: at(0),
    updatedAt: at(lastMinute),
    mergedAt,
    mergedBy,
    truncated: spec.truncated,
  });
  return { pr, headAfter: history.headAfter, lastMinute };
}

/**
 * Moments in one PR's life: right after its first `count` steps (at most one
 * past its last step: after the merge or close), never later than a minute
 * before now.
 */
class PrClock {
  constructor(
    private readonly prIndex: number,
    private readonly stepCount: number,
    private readonly nowMinute: number,
  ) {}

  /** The step count a moment falls after, at most one past the last step. */
  count(count: number): number {
    return Math.min(count, this.stepCount + 1);
  }

  after(count: number): string {
    return at(Math.min(afterMinute(this.prIndex, this.count(count)), this.nowMinute - 1));
  }
}

/** The events as the planner leaves them for one PR. */
function applyPlan(key: PrKey, events: PrEvent[], userState: UserPrState | null, cause: ReadCause, when: string, handles: boolean) {
  const before = { events: new Map([[key, events]]), userStates: new Map<PrKey, UserPrState>(userState ? [[key, userState]] : []) };
  const plan = planRead({ scope: prReadScope(key, handles), cause, ...before, at: when });
  const after = applyReadPlan(plan, before.events, before.userStates);
  return { events: after.events.get(key) ?? [], userState: after.userStates.get(key) ?? userState };
}

function markSeen(events: PrEvent[], ids: string[], seenAt: (event: PrEvent) => string): PrEvent[] {
  const wanted = new Set(ids);
  return events.map((event) => (wanted.has(event.id) && event.seenAt === null ? { ...event, seenAt: seenAt(event) } : event));
}

export interface PropertyBoard {
  spec: BoardSpec;
  viewer: Viewer;
  now: IsoTime;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  snoozes: Map<PrKey, Snooze>;
  threads: Map<PrKey, NotificationThread>;
  found: Map<PrKey, FoundPr>;
  /** Stored glance verdicts by PR. */
  glances: Map<PrKey, Verdict>;
  /** PRs whose glance says NOT_YOURS, as the Board reads them. */
  notYours: Set<PrKey>;
  /** Mark-reads waiting for the writes lock, by PR. */
  pendingWrites: Map<PrKey, TilePendingWrite>;
  /** When each stored snapshot was fetched. */
  prFetchedAt: Map<PrKey, IsoTime>;
  /** The spec each PR came from. */
  prSpecs: Map<PrKey, PrSpec>;
  /** The topic's tiles, from `buildTopicTiles`. */
  tiles: Tile[];
}

/** One PR's stored events and user state, made the way the sync and the app make them. */
function storedPrState(input: {
  spec: PrSpec;
  compiled: CompiledPr;
  clock: PrClock;
  viewer: Viewer;
  thread: NotificationThread | null;
  tracked: boolean;
}): { events: PrEvent[]; userState: UserPrState | null } {
  const { spec, compiled, clock, viewer, thread } = input;
  const pr = compiled.pr;
  let userState: UserPrState | null = null;
  if (spec.approvedAfter !== null && pr.state === 'OPEN' && !sameLogin(pr.author, viewer.login)) {
    // Approved while open: at most after the last step, before any merge or close.
    const count = Math.min(spec.approvedAfter, spec.steps.length);
    userState = { prKey: pr.key, approvedAt: clock.after(count), approvedCommitOid: compiled.headAfter[count] ?? null, handledAt: null };
  }
  let events = deriveEvents(pr, viewer, userState);
  // The Look closer ping adds its app-made event when the rule lets it, a minute after the request it pings for.
  if (spec.lookCloser && spec.glance === 'LOOK_CLOSER') {
    const check = lookCloserPingCheck({ pr, viewer, glance: { verdict: 'LOOK_CLOSER' }, userState, snoozed: false, pingedRequestId: null });
    const request = pr.timeline.find((item) => check.kind === 'ping' && item.id === check.requestId);
    if (check.kind === 'ping' && request) {
      const pingedAt = new Date(new Date(request.at).getTime() + 60_000).toISOString();
      events = [...events, lookCloserEvent(pr, check.team, check.requestId, pingedAt)];
    }
  }
  // The sync: GitHub's read time, the viewer's own events on a read thread, the last touch.
  if (thread?.lastReadAt) {
    events = applyPlan(pr.key, events, null, { kind: 'read_on_github', readAt: thread.lastReadAt }, thread.lastReadAt, false).events;
  }
  if (thread && !thread.unread) {
    events = markSeen(events, ownEventsOnReadThread(events, viewer.login).map((event) => event.id), (event) => event.at);
  }
  const touch = eventsSeenByTouch(pr, events, viewer);
  if (touch.touch !== null) {
    const touchAt = touch.touch.at;
    events = markSeen(events, touch.ids, () => touchAt);
  }
  // The app: Approve marks what was there seen; Mark read sees up to the click and handles a tracked PR.
  if (userState?.approvedAt) {
    const approvedAt = userState.approvedAt;
    events = applyPlan(pr.key, events, userState, { kind: 'pending_completion', clickedAt: approvedAt }, approvedAt, false).events;
  }
  if (spec.markedReadAfter !== null) {
    const clickedAt = clock.after(spec.markedReadAfter);
    const after = applyPlan(pr.key, events, userState, { kind: 'pending_completion', clickedAt }, clickedAt, input.tracked);
    events = after.events;
    userState = after.userState;
  }
  // The events agent's overrides, on derived events only.
  const derived = events.filter((event) => event.kind !== 'look_closer');
  for (const override of spec.overrides) {
    const target = derived[override.pick % Math.max(derived.length, 1)];
    if (target) {
      events = events.map((event) => (event.id === target.id ? { ...event, override: { loudness: override.loudness, reason: 'the events agent said so', by: 'agent' } } : event));
    }
  }
  // In store order: the event repo lists by time, then id.
  const inStoreOrder = events.toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { events: inStoreOrder, userState };
}

function snoozeCondition(spec: SnoozeSpec, now: string): SnoozeCondition {
  if (spec.condition === 'until_time') {
    const until = new Date(new Date(now).getTime() + (spec.untilPassed ? -60_000 : 24 * 60 * 60_000)).toISOString();
    return { kind: 'until_time', until };
  }
  return { kind: spec.condition };
}

function placeOf(groupIndex: number, index: number, kind: string, prIndex: number): PrPlace {
  const number = 10 * (groupIndex + 1) + index + 1;
  const baseRef = kind === 'stack' && index > 0 ? `branch-${number - 1}` : 'master';
  return { prIndex, number, baseRef, headRef: `branch-${number}` };
}

/** The board a spec describes. */
export function buildBoard(spec: BoardSpec): PropertyBoard {
  const viewer = propertyViewer(spec);
  const compiled: { spec: PrSpec; compiled: CompiledPr; prIndex: number; group: number }[] = [];
  let prIndex = 0;
  spec.groups.forEach((group, groupIndex) => {
    group.prs.forEach((prSpec, index) => {
      compiled.push({ spec: prSpec, compiled: compilePr(prSpec, placeOf(groupIndex, index, group.kind, prIndex)), prIndex, group: groupIndex });
      prIndex += 1;
    });
  });
  const lastMinute = Math.max(...compiled.map((entry) => entry.compiled.lastMinute));
  const nowMinute = lastMinute + spec.nowGap;
  const now = at(nowMinute);
  const clockOf = (entry: (typeof compiled)[number]) => new PrClock(entry.prIndex, entry.spec.steps.length, nowMinute);

  const board: PropertyBoard = {
    spec,
    viewer,
    now,
    prs: new Map(),
    events: new Map(),
    userStates: new Map(),
    snoozes: new Map(),
    threads: new Map(),
    found: new Map(),
    glances: new Map(),
    notYours: new Set(),
    pendingWrites: new Map(),
    prFetchedAt: new Map(),
    prSpecs: new Map(),
    tiles: [],
  };
  const pullInReasons = new Map<PrKey, string>();
  for (const entry of compiled) {
    const { pr } = entry.compiled;
    const tracking = entry.spec.tracking;
    board.prs.set(pr.key, pr);
    board.prSpecs.set(pr.key, entry.spec);
    let thread: NotificationThread | null = null;
    if (tracking.kind === 'thread') {
      const lastReadAt = tracking.readAfter === null ? null : clockOf(entry).after(tracking.readAfter);
      thread = {
        id: `thread-${pr.ref.number}`,
        reason: tracking.reason,
        unread: lastReadAt === null || lastReadAt < pr.updatedAt,
        updatedAt: pr.updatedAt,
        lastReadAt,
        subjectType: 'PullRequest',
        repo: pr.ref.repo,
        number: pr.ref.number,
        title: pr.title,
      };
      board.threads.set(pr.key, thread);
    } else if (tracking.kind === 'found') {
      const via = sameLogin(pr.author, viewer.login) ? 'own_open' : pr.state === 'MERGED' ? 'involved_merged' : 'review_requested';
      board.found.set(pr.key, { prKey: pr.key, via, reason: 'found by the sync', foundAt: now });
    } else {
      pullInReasons.set(pr.key, `stack layer below #${pr.ref.number + 1}`);
    }
    const stored = storedPrState({ spec: entry.spec, compiled: entry.compiled, clock: clockOf(entry), viewer, thread, tracked: tracking.kind !== 'pulled_in' });
    board.events.set(pr.key, stored.events);
    if (stored.userState) {
      board.userStates.set(pr.key, stored.userState);
    }
    if (entry.spec.glance !== null) {
      board.glances.set(pr.key, entry.spec.glance);
      if (entry.spec.glance === 'NOT_YOURS') {
        board.notYours.add(pr.key);
      }
    }
    if (spec.writesLocked && entry.spec.pendingWrite && thread?.unread) {
      board.pendingWrites.set(pr.key, { since: now, error: null });
    }
    board.prFetchedAt.set(pr.key, entry.spec.staleSnapshot && thread ? at(entry.compiled.lastMinute - 1) : now);
  }

  const sets: PrSet[] = spec.groups.flatMap((group, groupIndex) => {
    if (group.kind !== 'set') {
      return [];
    }
    const keys = compiled.filter((entry) => entry.group === groupIndex).map((entry) => entry.compiled.pr.key);
    return [
      {
        id: `s${groupIndex}`,
        topicId: PROPERTY_TOPIC_ID,
        title: `Set ${groupIndex}`,
        take: '',
        members: keys.map((key) => ({ prKey: key, reason: 'same change' })),
        removedKeys: [],
        status: 'active',
        inputHash: '',
        createdAt: at(0),
        updatedAt: at(0),
      },
    ];
  });
  const memberKeys = compiled.map((entry) => entry.compiled.pr.key).filter((key) => board.threads.has(key) || board.found.has(key));
  board.tiles = buildTopicTiles({
    topicId: PROPERTY_TOPIC_ID,
    memberKeys,
    prs: board.prs,
    threads: board.threads,
    stacks: buildStacks([...board.prs.values()]),
    sets,
    events: board.events,
    pullInReasons,
    found: board.found,
  });

  // Snoozes: one per PR as it was put away, then a whole-tile snooze through `snoozeWrites` (it replaces them).
  for (const entry of compiled) {
    const snooze = entry.spec.snooze;
    const key = entry.compiled.pr.key;
    if (snooze === null || !board.tiles.some((tile) => tile.members.some((member) => member.prKey === key && isTracked(member.provenance)))) {
      continue;
    }
    board.snoozes.set(key, { prKey: key, condition: snoozeCondition(snooze, now), since: clockOf(entry).after(snooze.after) });
  }
  spec.groups.forEach((group, groupIndex) => {
    const snooze = group.snooze;
    const firstKey = compiled.find((entry) => entry.group === groupIndex)?.compiled.pr.key;
    const tile = board.tiles.find((candidate) => candidate.members.some((member) => member.prKey === firstKey));
    if (snooze === null || !tile) {
      return;
    }
    const since = at(Math.min(Math.max(0, lastMinute - snooze.after * 10), nowMinute - 1));
    for (const put of snoozeWrites(tile, { kind: 'start', condition: snoozeCondition(snooze, now), at: since }).put) {
      board.snoozes.set(put.prKey, put);
    }
  });
  return board;
}

/** A copy of the board with other events and user states, for what a read leaves. */
export function withReadState(board: PropertyBoard, events: Map<PrKey, PrEvent[]>, userStates: Map<PrKey, UserPrState>): PropertyBoard {
  return { ...board, events, userStates };
}

export function tileStateOf(board: PropertyBoard, tile: Tile): TileState {
  return deriveTileState({
    tile,
    prs: board.prs,
    events: board.events,
    userStates: board.userStates,
    snoozes: board.snoozes,
    now: board.now,
    viewer: board.viewer,
    notYours: board.notYours,
  });
}

function prRows(board: PropertyBoard, tile: Tile, state: TileState): PrSummary[] {
  return tile.members.flatMap((member) => {
    const pr = board.prs.get(member.prKey);
    if (!pr) {
      return [];
    }
    const verdict = board.glances.get(pr.key) ?? null;
    return [
      buildPrSummary({
        pr,
        member,
        viewer: board.viewer,
        userState: board.userStates.get(pr.key) ?? null,
        events: board.events.get(pr.key) ?? [],
        reason: board.threads.get(pr.key)?.reason ?? null,
        glance: verdict === null ? null : { verdict, forYou: 'Routed to your team; nothing risky.' },
        glanceStale: false,
        glanceGap: null,
        glanceState: verdict === null ? 'none' : 'ready',
        quietRepo: false,
        repoLabel: null,
        tileUnread: state.kind === 'unread',
        now: board.now,
        pendingWrite: board.pendingWrites.get(pr.key) ?? null,
      }),
    ];
  });
}

/** One tile as the read models build it: state, rows, then the view with its offers. */
export function tileViewOf(board: PropertyBoard, tile: Tile): TileView {
  const state = tileStateOf(board, tile);
  return buildTileView({
    tile,
    state,
    prs: prRows(board, tile, state),
    prsByKey: board.prs,
    events: board.events,
    userStates: board.userStates,
    viewer: board.viewer,
    notYours: board.notYours,
    pendingWrite: tile.members.map((member) => board.pendingWrites.get(member.prKey)).find((write) => write !== undefined) ?? null,
    quietRepo: false,
    repoLabel: null,
    now: board.now,
  });
}

/** Every tile of the board as a view, in tile order. */
export function tileViewsOf(board: PropertyBoard): TileView[] {
  return board.tiles.map((tile) => tileViewOf(board, tile));
}
