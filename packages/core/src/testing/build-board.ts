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
import { awaitsJudgement, type OpenedReadInput } from '../quiet-reads.ts';
import { ownEventsOnReadThread } from '../github-read.ts';
import { lookCloserEvent, lookCloserPingCheck } from '../glance-pings.ts';
import { sameLogin } from '../mentions.ts';
import { isTracked } from '../provenance.ts';
import { applyReadPlan, planRead, prReadScope, type ReadCause } from '../read-plan.ts';
import { snoozeWrites } from '../snooze.ts';
import { buildStacks } from '../stacks.ts';
import { buildTopicTiles, deriveTileState } from '../tiles.ts';
import { prAfterMarkRead } from '../after-read.ts';
import { agentPrFacts } from '../agent-actions.ts';
import { buildPrSummary, buildTileView, type PrSummaryInput } from '../tile-view.ts';
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
import type { TilePendingWrite, TileView } from '../views.ts';
import type { BoardSpec, CommentText, GroupKind, GroupSpec, Person, PrSpec, RequestTarget, RiskWord, SnoozeSpec, StepSpec, TeamSetup, TrunkText } from './board-spec.ts';

export const PROPERTY_REPO = 'acme/app';
export const PROPERTY_TOPIC_ID = 'topic-1';
export const PROPERTY_TEAM = 'acme/team-platform';
export const OTHER_TEAM = 'acme/team-infra';
/** The viewer's second team on most boards: a big approvers group, routing only unless roles are undecided. */
export const ROUTING_TEAM = 'acme/approvers';
/** Who makes a bot's review request. */
export const REQUEST_BOT = 'github-actions[bot]';
/** Trunk's merge queue bot, which keeps a status comment on the PR. */
export const TRUNK_LOGIN = 'trunk-io[bot]';

/** ghost: a deleted account, which GitHub reads back as ''. */
export const LOGINS: Record<Person, string> = {
  viewer: 'viewer',
  teammate: 'lyra',
  other: 'ada',
  outsider: 'alice',
  bot: 'dependabot[bot]',
  app: 'renovate',
  agent: 'acme-agent[bot]',
  ghost: '',
};

/** The glance's risk line for each risk word; garbage starts with a word that only looks like a level. */
export const RISK_LINES: Record<RiskWord, string> = {
  low: 'low - routed review',
  medium: 'medium - touches the worker loop',
  high: 'high - rewrites the login flow',
  garbage: 'lowish - hard to say',
};

/** Every automation account on a board: what the spec oracles call automation, without asking `isBot`. */
export const AUTOMATION_LOGINS: readonly string[] = [LOGINS.bot, LOGINS.app, LOGINS.agent, REQUEST_BOT, TRUNK_LOGIN];

/** The login or team a request target names; the teammate asked is rowan, so lyra can still be the author. */
export function requestSubject(target: RequestTarget): string {
  switch (target) {
    case 'viewer':
      return LOGINS.viewer;
    case 'team':
      return PROPERTY_TEAM;
    case 'other_team':
      return OTHER_TEAM;
    case 'routing_team':
      return ROUTING_TEAM;
    case 'teammate':
      return 'rowan';
    case 'other':
      return LOGINS.other;
  }
}

/** Who is on each of the viewer's teams (the viewer left out). */
const TEAM_MEMBERS: Record<string, string[]> = { [PROPERTY_TEAM]: ['lyra', 'rowan'], [ROUTING_TEAM]: ['alice', 'rowan'] };

/** The viewer's teams, and the home teams among them (undefined: roles not decided yet). */
function viewerTeams(setup: TeamSetup): { teams: string[]; homeTeams: string[] | undefined } {
  switch (setup) {
    case 'one_home':
      return { teams: [PROPERTY_TEAM], homeTeams: [PROPERTY_TEAM] };
    case 'home_and_routing':
      return { teams: [PROPERTY_TEAM, ROUTING_TEAM], homeTeams: [PROPERTY_TEAM] };
    case 'no_home':
      return { teams: [PROPERTY_TEAM, ROUTING_TEAM], homeTeams: [] };
    case 'undecided':
      return { teams: [PROPERTY_TEAM, ROUTING_TEAM], homeTeams: undefined };
  }
}

/**
 * The viewer as the engine stores it: the members of the home teams (every
 * team while roles are undecided) are the teammates, fetched unless the
 * recipe says the list never was; routing teams are never fetched.
 */
export function propertyViewer(spec: Pick<BoardSpec, 'teamMembersUnknown' | 'teams'>): Viewer {
  const { teams, homeTeams } = viewerTeams(spec.teams);
  const viewer: Viewer = homeTeams === undefined ? { login: LOGINS.viewer, teams } : { login: LOGINS.viewer, teams, homeTeams };
  if (spec.teamMembersUnknown) {
    return viewer;
  }
  const members = (homeTeams ?? teams).flatMap((team) => TEAM_MEMBERS[team] ?? []);
  return { ...viewer, teamMembers: [...new Set(members)] };
}

export const COMMENT_BODIES: Record<CommentText, string> = {
  plain: 'looks fine',
  mention: 'cc @viewer',
  question: '@viewer can you check the migration?',
  team_mention: 'cc @acme/team-platform',
  routing_mention: 'cc @acme/approvers',
  teams_mention: 'cc @acme/approvers and @acme/team-platform',
  bot_marker: '<!-- bot --> automated comment: coverage went down',
  deploy: 'Deployed the preview',
};

/** The teams each comment names with an @-mention: what the spec oracles read instead of parsing the body. */
export const MENTIONED_TEAMS: Record<CommentText, string[]> = {
  plain: [],
  mention: [],
  question: [],
  team_mention: [PROPERTY_TEAM],
  routing_mention: [ROUTING_TEAM],
  teams_mention: [ROUTING_TEAM, PROPERTY_TEAM],
  bot_marker: [],
  deploy: [],
};

/** What trunk writes for each status, in its words (an en space after the emoji, like trunk). */
export const TRUNK_BODIES: Record<TrunkText, string> = {
  offer: '<!-- Trunk Merge -->\nMerging to `main` in this repository is managed by Trunk.\n\n- [ ] To merge this pull request, check the box to the left or comment `/trunk merge` below.',
  submitted: '<!-- Trunk Merge -->\n✨\u2002Submitted to Merge by Ada Example (a GitHub user). It will be added to the merge queue once all branch protection rules pass.',
  testing: '<!-- Trunk Merge -->\n🧪\u2002Running tests on this pull request (testing on PR [#90](https://github.com/acme/app/pull/90)) - [details](https://trunk.example/q/1).',
  stack_testing: '<!-- Trunk Merge -->\n🧪\u2002Running tests on this stack (testing on PR [#91](https://github.com/acme/app/pull/91)) - [details](https://trunk.example/q/3).',
  failed: 'Stacked PR [90](https://github.com/acme/app/pull/90) failed testing in the merge queue. Please investigate the failure and re-submit the stack.',
  emoji_failed: '❌\u2002This pull request did not make it through the merge queue.',
  cancelled: 'Stacked PR [90](https://github.com/acme/app/pull/90) was cancelled: a user cancelled it.',
  merged: '😎\u2002Merged successfully - [details](https://trunk.example/q/2).',
  garbage: '🛸\u2002Something new happened in the merge queue.',
};

/** The timeline item an automation step adds. */
const AUTOMATION_ITEMS = { queued: 'added_to_merge_queue', unqueued: 'removed_from_merge_queue', deployed: 'deployed' } as const;

/** Minute of step `index` (0-based) of the PR at `prIndex`: ten minutes apart, never on the same minute as another PR's. */
function stepMinute(prIndex: number, index: number): number {
  return 10 * (index + 1) + prIndex;
}

/** Minute right after the first `count` steps (0: before any step). */
function afterMinute(prIndex: number, count: number): number {
  return 10 * count + prIndex + 5;
}

/** A human who asks for a review: the author, or ada when a GitHub App or a deleted account opened the PR. */
function humanRequester(author: string): string {
  return author === LOGINS.bot || author === LOGINS.agent || author === LOGINS.ghost ? LOGINS.other : author;
}

/** The viewer owns the PR the recipe describes: wrote it, or it is a bot's PR assigned to them (DESIGN "PR ownership"). */
function viewerOwns(spec: PrSpec): boolean {
  const botAuthor = spec.author === 'bot' || spec.author === 'app' || spec.author === 'agent';
  return botAuthor && spec.assignees.length > 0 ? spec.assignees.includes('viewer') : spec.author === 'viewer';
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
  /** In the merge queue. */
  queued = false;
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

  /** Asks again every reviewer whose latest verdict asks for changes and who is not pending already, as the author. */
  private rerequest(index: number, time: string): void {
    const latest = new Map<string, Review>();
    for (const review of this.reviews) {
      if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
        latest.set(review.author, review);
      }
    }
    let count = 0;
    for (const [login, review] of latest) {
      if (review.state !== 'CHANGES_REQUESTED' || this.reviewerUsers.includes(login)) {
        continue;
      }
      this.reviewerUsers.push(login);
      this.timeline.push({ id: this.id('tl', index) + (count > 0 ? `-${count}` : ''), kind: 'review_requested', actor: humanRequester(this.author), at: time, subject: login });
      count += 1;
    }
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

  /** Edits an earlier comment in place (the thread holds the same object); a review body's review gets the new text too. */
  private edit(step: Extract<StepSpec, { kind: 'edit' }>, time: string): void {
    const comment = this.comments[step.pick % Math.max(this.comments.length, 1)];
    if (comment === undefined) {
      return;
    }
    comment.editor = step.by === 'author' ? comment.author : LOGINS[step.by];
    comment.lastEditedAt = time;
    if (step.text !== null) {
      comment.body = COMMENT_BODIES[step.text];
      const review = this.reviews.find((candidate) => candidate.id === comment.id);
      if (review) {
        review.body = comment.body;
      }
    }
  }

  private review(step: Extract<StepSpec, { kind: 'review' }>, index: number, time: string): void {
    const login = LOGINS[step.by];
    const id = this.id('rv', index);
    // GitHub lets an author only comment on their own PR (or keep a review unsent).
    const state = step.state === 'PENDING' || !sameLogin(login, this.author) ? step.state : 'COMMENTED';
    const body = step.body ? COMMENT_BODIES[step.body] : '';
    this.reviews.push({ id, author: login, state, body, submittedAt: time, commitOid: this.headOid });
    if (state === 'PENDING') {
      // An unsent review answers no request, and GitHub shows its body to nobody else.
      return;
    }
    if (body !== '') {
      // Like the reader: a submitted review's body is also a comment of kind review, with the review's id.
      this.comments.push({ id, author: login, body, createdAt: time, kind: 'review', url: `https://github.com/${PROPERTY_REPO}/pull/${this.number}#review-${index}`, path: null, threadId: null });
    }
    const position = this.reviewerUsers.findIndex((user) => sameLogin(user, login));
    if (position >= 0) {
      this.reviewerUsers.splice(position, 1);
    }
  }

  /** Merge queue and deploys, by the request bot; a draft never enters the queue. */
  private automation(step: Extract<StepSpec, { kind: 'automation' }>, index: number, time: string): void {
    if (step.item === 'queued') {
      if (this.isDraft || this.queued) {
        return;
      }
      this.queued = true;
    }
    if (step.item === 'unqueued') {
      if (!this.queued) {
        return;
      }
      this.queued = false;
    }
    this.timeline.push({ id: this.id('tl', index), kind: AUTOMATION_ITEMS[step.item], actor: REQUEST_BOT, at: time, subject: null });
  }

  /** Trunk's status: an edit of its first comment (sticky, when it has one), else a new comment. */
  private trunk(step: Extract<StepSpec, { kind: 'trunk' }>, index: number, time: string): void {
    const body = TRUNK_BODIES[step.text];
    const sticky = step.sticky ? this.comments.find((comment) => comment.author === TRUNK_LOGIN) : undefined;
    if (sticky) {
      sticky.body = body;
      sticky.lastEditedAt = time;
      sticky.editor = TRUNK_LOGIN;
      return;
    }
    const url = `https://github.com/${PROPERTY_REPO}/pull/${this.number}#comment-${index}`;
    this.comments.push({ id: this.id('cm', index), author: TRUNK_LOGIN, body, createdAt: time, kind: 'comment', url, path: null, threadId: null });
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
      case 'rerequest':
        this.rerequest(index, time);
        break;
      case 'comment':
        this.comment(step, index, time);
        break;
      case 'edit':
        this.edit(step, time);
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
      case 'automation':
        this.automation(step, index, time);
        break;
      case 'trunk':
        this.trunk(step, index, time);
        break;
      case 'to_draft':
        if (!this.isDraft && !this.queued) {
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
    assignees: spec.assignees.map((assignee) => LOGINS[assignee]),
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
  /** The stored glance's risk line by PR (`RISK_LINES`), for every PR with a glance. */
  glanceRisks: Map<PrKey, string>;
  /** PRs whose stored glance is stale. */
  staleGlances: Set<PrKey>;
  /** PRs whose glance says NOT_YOURS, as the Board reads them. */
  notYours: Set<PrKey>;
  /** Mark-reads waiting for the writes lock, by PR. */
  pendingWrites: Map<PrKey, TilePendingWrite>;
  /** When each stored snapshot was fetched. */
  prFetchedAt: Map<PrKey, IsoTime>;
  /** The spec each PR came from. */
  prSpecs: Map<PrKey, PrSpec>;
  /** Each group's PR keys, in group order (the recipe's shape, for the layout oracle). */
  groupKeys: PrKey[][];
  /** When Mark read was clicked in the app, by PR (the recipe's `markedReadAfter`). */
  markedReadAt: Map<PrKey, IsoTime>;
  /** The topic's tiles, from `buildTopicTiles`. */
  tiles: Tile[];
}

/**
 * GitHub's read time of the PR's thread: the recipe's read, and a Mark read
 * or Approve in the app, which reach GitHub at the click (the recipe's clicks
 * model a completed mark-read). Null when none of them happened.
 */
function threadReadAt(spec: PrSpec, pr: Pr, viewer: Viewer, clock: PrClock): IsoTime | null {
  const approved = spec.approvedAfter !== null && pr.state === 'OPEN' && !sameLogin(pr.author, viewer.login);
  const times = [
    spec.tracking.kind === 'thread' && spec.tracking.readAfter !== null ? clock.after(spec.tracking.readAfter) : null,
    spec.markedReadAfter === null ? null : clock.after(spec.markedReadAfter),
    approved ? clock.after(Math.min(spec.approvedAfter!, spec.steps.length)) : null,
  ].filter((time): time is IsoTime => time !== null);
  return times.toSorted().at(-1) ?? null;
}

/** One PR's stored events and user state, made the way the sync and the app make them. */
function storedPrState(input: {
  spec: PrSpec;
  compiled: CompiledPr;
  clock: PrClock;
  viewer: Viewer;
  thread: NotificationThread | null;
  tracked: boolean;
}): { events: PrEvent[]; userState: UserPrState | null; markedReadAt: IsoTime | null } {
  const { spec, compiled, clock, viewer, thread } = input;
  const pr = compiled.pr;
  let userState: UserPrState | null = null;
  // The app offers Approve only on a PR someone else owns.
  if (spec.approvedAfter !== null && pr.state === 'OPEN' && !viewerOwns(spec)) {
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
  const markedReadAt = spec.markedReadAfter === null ? null : clock.after(spec.markedReadAfter);
  if (markedReadAt !== null) {
    const clickedAt = markedReadAt;
    const after = applyPlan(pr.key, events, userState, { kind: 'pending_completion', clickedAt }, clickedAt, input.tracked);
    events = after.events;
    userState = after.userState;
  }
  // The events agent judged people's unseen quiet activity and left it quiet (`awaitsJudgement` picks what the engine sends it: not asks).
  if (spec.judged) {
    events = events.map((event) => (awaitsJudgement(event, pr, viewer) ? { ...event, override: { loudness: 'quiet', reason: 'nothing here needs you', by: 'agent' } } : event));
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
  return { events: inStoreOrder, userState, markedReadAt };
}

function snoozeCondition(spec: SnoozeSpec, now: string): SnoozeCondition {
  if (spec.condition === 'until_time') {
    const until = new Date(new Date(now).getTime() + (spec.untilPassed ? -60_000 : 24 * 60 * 60_000)).toISOString();
    return { kind: 'until_time', until };
  }
  return { kind: spec.condition };
}

/** The PR sits on the one before it in its group: every layer after the first of a stack, the second PR of a set with a stack. */
function sitsOnPrevious(kind: GroupKind, index: number): boolean {
  return (kind === 'stack' && index > 0) || (kind === 'set_with_stack' && index === 1);
}

function placeOf(groupIndex: number, index: number, kind: GroupKind, prIndex: number): PrPlace {
  const number = 10 * (groupIndex + 1) + index + 1;
  const baseRef = sitsOnPrevious(kind, index) ? `branch-${number - 1}` : 'master';
  return { prIndex, number, baseRef, headRef: `branch-${number}` };
}

/** The set a group makes, if any: a set with a stack lists only the stack's upper layer, a dissolved set keeps its members but is not active. */
function setOf(group: GroupSpec, groupIndex: number, keys: PrKey[]): PrSet | null {
  if (group.kind !== 'set' && group.kind !== 'set_with_stack' && group.kind !== 'dissolved_set') {
    return null;
  }
  const listed = group.kind === 'set_with_stack' ? keys.slice(1) : keys;
  return {
    id: `s${groupIndex}`,
    topicId: PROPERTY_TOPIC_ID,
    title: `Set ${groupIndex}`,
    take: '',
    members: listed.map((key) => ({ prKey: key, reason: 'same change' })),
    removedKeys: [],
    status: group.kind === 'dissolved_set' ? 'dissolved' : 'active',
    inputHash: '',
    createdAt: at(0),
    updatedAt: at(0),
  };
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
    glanceRisks: new Map(),
    staleGlances: new Set(),
    notYours: new Set(),
    pendingWrites: new Map(),
    prFetchedAt: new Map(),
    prSpecs: new Map(),
    groupKeys: spec.groups.map((_, groupIndex) => compiled.filter((entry) => entry.group === groupIndex).map((entry) => entry.compiled.pr.key)),
    markedReadAt: new Map(),
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
      const lastReadAt = threadReadAt(entry.spec, pr, viewer, clockOf(entry));
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
      // The finder's aliases: the viewer's own PRs (an agent PR assigned to them too), merged ones they took part in, a person's PR assigned to them, review requests.
      const assigned = entry.spec.assignees.includes('viewer');
      const via = viewerOwns(entry.spec) ? 'own_open' : pr.state === 'MERGED' ? 'involved_merged' : assigned ? 'assigned' : 'review_requested';
      board.found.set(pr.key, { prKey: pr.key, via, reason: 'found by the sync', foundAt: now });
    } else {
      pullInReasons.set(pr.key, `stack layer below #${pr.ref.number + 1}`);
    }
    const stored = storedPrState({ spec: entry.spec, compiled: entry.compiled, clock: clockOf(entry), viewer, thread, tracked: tracking.kind !== 'pulled_in' });
    board.events.set(pr.key, stored.events);
    if (stored.markedReadAt !== null) {
      board.markedReadAt.set(pr.key, stored.markedReadAt);
    }
    if (stored.userState) {
      board.userStates.set(pr.key, stored.userState);
    }
    if (entry.spec.glance !== null) {
      board.glances.set(pr.key, entry.spec.glance);
      board.glanceRisks.set(pr.key, RISK_LINES[entry.spec.glanceRisk]);
      if (entry.spec.glanceStale) {
        board.staleGlances.add(pr.key);
      }
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
    const set = setOf(group, groupIndex, compiled.filter((entry) => entry.group === groupIndex).map((entry) => entry.compiled.pr.key));
    return set ? [set] : [];
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

/** `viewer`: the board's viewer, or null for a board before the first sync stored one. */
export function tileStateOf(board: PropertyBoard, tile: Tile, viewer: Viewer | null = board.viewer): TileState {
  return deriveTileState({
    tile,
    prs: board.prs,
    events: board.events,
    threads: board.threads,
    userStates: board.userStates,
    snoozes: board.snoozes,
    now: board.now,
    viewer,
    notYours: board.notYours,
  });
}

/** What the "opened in PostPile" rule reads of a PR, gathered like the engine's OpenedReadInputs. */
function openedInputOf(board: PropertyBoard, pr: Pr, viewer: Viewer | null): OpenedReadInput {
  const holding = board.tiles.filter((tile) => tile.members.some((member) => member.prKey === pr.key));
  const tracked = holding.some((tile) => tile.members.some((member) => member.prKey === pr.key && isTracked(member.provenance)));
  const afterRead = prAfterMarkRead({
    pr,
    events: board.events.get(pr.key) ?? [],
    userState: board.userStates.get(pr.key) ?? null,
    viewer,
    notYours: board.notYours.has(pr.key),
    tracked,
    readAt: board.now,
  });
  return {
    thread: board.threads.get(pr.key) ?? null,
    prFetchedAt: board.prFetchedAt.get(pr.key) ?? null,
    pr,
    tiles: holding.map((tile) => ({ snoozed: tileStateOf(board, tile, viewer).kind === 'snoozed' })),
    doneAfterRead: afterRead.done,
  };
}

function prRowInputs(board: PropertyBoard, tile: Tile, state: TileState, viewer: Viewer | null): PrSummaryInput[] {
  return tile.members.flatMap((member): PrSummaryInput[] => {
    const pr = board.prs.get(member.prKey);
    if (!pr) {
      return [];
    }
    const verdict = board.glances.get(pr.key) ?? null;
    return [
      {
        pr,
        member,
        viewer,
        userState: board.userStates.get(pr.key) ?? null,
        events: board.events.get(pr.key) ?? [],
        reason: board.threads.get(pr.key)?.reason ?? null,
        glance: verdict === null ? null : { verdict, forYou: 'Routed to your team; nothing risky.', risk: board.glanceRisks.get(pr.key) ?? RISK_LINES.low },
        glanceStale: board.staleGlances.has(pr.key),
        glanceGap: null,
        glanceRefreshBlock: null,
        glanceState: verdict === null ? 'none' : 'ready',
        quietRepo: false,
        repoLabel: null,
        tileUnread: state.kind === 'unread',
        unreadOnGitHub: board.threads.get(pr.key)?.unread === true,
        lastReadAt: board.threads.get(pr.key)?.lastReadAt ?? null,
        now: board.now,
        pendingWrite: board.pendingWrites.get(pr.key) ?? null,
        opened: openedInputOf(board, pr, viewer),
      },
    ];
  });
}

/** One tile as the read models build it: state, rows, then the view with its offers. */
export function tileViewOf(board: PropertyBoard, tile: Tile, viewer: Viewer | null = board.viewer): TileView {
  const state = tileStateOf(board, tile, viewer);
  const rows = prRowInputs(board, tile, state, viewer);
  return buildTileView({
    tile,
    state,
    prs: rows.map(buildPrSummary),
    agentPrs: rows.map(agentPrFacts),
    prsByKey: board.prs,
    events: board.events,
    userStates: board.userStates,
    viewer,
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
