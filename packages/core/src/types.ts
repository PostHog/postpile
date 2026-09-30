// Domain types shared by every package. No IO, no runtime code.
//
// Timestamps are ISO 8601 strings everywhere. They survive JSON (HTTP API,
// SQLite TEXT columns) without conversion and compare correctly as strings.

export type IsoTime = string;

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/** "owner/name#123". The one identifier used across store, API and UI. */
export type PrKey = string;

export interface PrRef {
  /** "owner/name" */
  repo: string;
  number: number;
}

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE';

export interface Review {
  id: string;
  author: string;
  state: ReviewState;
  body: string;
  submittedAt: IsoTime;
  /** Head commit the review was made against. Used for "new commits after approval". */
  commitOid: string | null;
}

export interface Commit {
  oid: string;
  headline: string;
  author: string;
  /**
   * Who committed it (GitHub login, else the git name). Differs from the
   * author after someone else's cherry-pick or rebase, and is GitHub's
   * web-flow for commits made in the web UI. Absent in snapshots stored
   * before it was fetched.
   */
  committer?: string;
  committedAt: IsoTime;
}

export type CommentKind = 'comment' | 'review' | 'review_comment';

/** Any authored body on a PR: issue comment, review body, or inline review comment. */
export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: IsoTime;
  kind: CommentKind;
  url: string;
  /** Only for review_comment. */
  path: string | null;
  /** Only for review_comment: the review thread it belongs to. */
  threadId: string | null;
}

export interface ReviewThread {
  id: string;
  path: string;
  isResolved: boolean;
  comments: Comment[];
}

export type CheckRollup = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NONE';

export interface CheckContext {
  name: string;
  /** SUCCESS, FAILURE, NEUTRAL, SKIPPED, CANCELLED, TIMED_OUT, ACTION_REQUIRED, or null while running. */
  conclusion: string | null;
  completedAt: IsoTime | null;
}

export interface Checks {
  rollup: CheckRollup;
  contexts: CheckContext[];
}

export type TimelineItemKind =
  | 'review_requested'
  | 'review_request_removed'
  | 'merged'
  | 'closed'
  | 'reopened'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'head_ref_force_pushed'
  | 'added_to_merge_queue'
  | 'removed_from_merge_queue'
  | 'deployed';

/** Timeline entries that are not comments, reviews or commits. */
export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  actor: string;
  at: IsoTime;
  /** review_requested / review_request_removed: login or "org/team-slug". */
  subject: string | null;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

/** A normalized PR snapshot as fetched from GitHub. */
export interface Pr {
  key: PrKey;
  ref: PrRef;
  title: string;
  url: string;
  body: string;
  author: string;
  /**
   * Assigned users' logins. An agent PR a GitHub App opens for a person
   * names that person here; `prOwners` reads it. Missing on snapshots
   * stored before it was fetched: read as none.
   */
  assignees?: string[];
  state: PrState;
  isDraft: boolean;
  baseRef: string;
  headRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: PrFile[];
  labels: string[];
  reviewDecision: ReviewDecision;
  /** Still-pending review requests: user logins. */
  reviewerUsers: string[];
  /** Still-pending review requests: "org/team-slug". */
  reviewerTeams: string[];
  reviews: Review[];
  commits: Commit[];
  /**
   * Every authored body: issue comments, non-empty review bodies and inline
   * review-thread comments, oldest first. Inline comments are also in
   * `threads`, grouped; read this list for "all comments".
   */
  comments: Comment[];
  threads: ReviewThread[];
  timeline: TimelineItem[];
  checks: Checks;
  headOid: string;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  mergedAt: IsoTime | null;
  mergedBy: string | null;
  /**
   * Base branches the PR had before, oldest first. GitHub moves a stacked PR
   * onto the next branch down when the layer below merges and its branch is
   * deleted; this is how the merged layer stays in the stack. Missing on
   * snapshots stored before it existed.
   */
  previousBaseRefs?: string[];
  /**
   * The head branch lives in a fork. Its branch name says nothing about
   * stacks in this repo (forks often use main or patch-1), so it never links
   * to a stack. Missing on snapshots stored before it existed: read as false.
   */
  isCrossRepository?: boolean;
  /**
   * The snapshot was cut off at the query's caps: more reviews, comments,
   * review threads, comments in one thread, commits or timeline items than
   * it asked for. An event past the caps is missing, so no quiet mark-read
   * trusts this snapshot. Missing on
   * snapshots stored before it existed: read as false.
   */
  truncated?: boolean;
  /**
   * The capped lists that hit their cap, from the raw answer before any
   * node was dropped: the list, how many nodes came back, and the oldest
   * item among them (null where no time applies). Empty when no list hit
   * its cap (a snapshot can be `truncated` because GitHub counts items it
   * never returns). Missing on snapshots stored before it existed: then a
   * truncated snapshot never vouches (`cutSnapshotCovers`).
   */
  capHits?: CapHit[];
}

/** The PR query's capped activity lists (packages/github `queries.ts`). */
export type CappedList = 'reviews' | 'comments' | 'review_threads' | 'thread_comments' | 'commits' | 'timeline';

/** One capped list that came back full with more on GitHub. */
export interface CapHit {
  list: CappedList;
  /** Nodes GitHub returned, before normalizing dropped any. */
  nodes: number;
  /** The oldest of them; null for review threads and a thread's comments. */
  oldestAt: IsoTime | null;
}

// ---------------------------------------------------------------------------
// Notifications and the viewer
// ---------------------------------------------------------------------------

export type NotificationReason =
  | 'review_requested'
  | 'mention'
  | 'team_mention'
  | 'author'
  | 'assign'
  | 'comment'
  | 'subscribed'
  | 'manual'
  | 'state_change'
  | 'ci_activity'
  | 'approval_requested'
  | 'other';

/** A trimmed GitHub notification thread. GitHub keeps one thread per PR. */
export interface NotificationThread {
  id: string;
  reason: NotificationReason;
  unread: boolean;
  updatedAt: IsoTime;
  lastReadAt: IsoTime | null;
  /** PullRequest, Issue, Release, ... Only PullRequest threads become tiles for now. */
  subjectType: string;
  repo: string;
  /** Null for subjects without a number (releases, discussions). */
  number: number | null;
  title: string;
}

export interface Viewer {
  login: string;
  /**
   * "org/team-slug" for every team the viewer belongs to, home and routing
   * alike: review requests to any of them are found and shown.
   */
  teams: string[];
  /**
   * The home teams among `teams` (`team-roles.ts`, 2026-09-30): their
   * members are the viewer's teammates. The other teams only route review
   * requests and mentions. Empty is valid (no home team: no teammates).
   * Missing until the roles are first decided; every team then counts as
   * home, like before roles existed.
   */
  homeTeams?: string[];
  /**
   * Every other login on the home teams, fetched at most daily. Missing
   * until the first fetch (or in a viewer stored before it existed); rules
   * then fall back to treating any other reviewer as a teammate.
   */
  teamMembers?: string[];
  /**
   * GitHub's numeric user id, the input to the telemetry identity hash.
   * Never shown in the UI. Missing on a viewer stored before it existed;
   * the next sync backfills it.
   */
  databaseId?: number;
}

// ---------------------------------------------------------------------------
// Events and loudness
// ---------------------------------------------------------------------------

export type EventKind =
  | 'mention'
  | 'team_mention'
  | 'review_requested'
  | 'review_request_removed'
  | 'reply_to_user'
  | 'question_to_user'
  | 'comment'
  | 'review_approved'
  | 'review_changes_requested'
  | 'review_commented'
  | 'commits_pushed'
  | 'commits_after_approval'
  | 'force_pushed'
  | 'merged'
  | 'merged_without_review'
  | 'closed'
  | 'reopened'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'ci'
  | 'deploy'
  | 'merge_queue'
  | 'bot_comment'
  /** App-made, not from GitHub: the glance said Look closer on a review routed to the viewer's team (see glance-pings.ts). */
  | 'look_closer';

/**
 * How much an event should grab attention.
 * - loud: makes the tile unread
 * - quiet: shown with a dot, no state change
 * - muted: the agent decided it is noise; one click to unmute
 *
 * "seen" is not a classification but a user state (seenAt set). Use
 * EventDisplayState for what the UI renders.
 */
export type Loudness = 'loud' | 'quiet' | 'muted';

export type EventDisplayState = Loudness | 'seen';

export interface LoudnessOverride {
  loudness: Loudness;
  reason: string;
  by: 'agent' | 'user';
}

/** One activity line on a PR. Derived from the PR snapshot, never typed in by hand. */
export interface PrEvent {
  /** Stable across syncs: "<prKey>:<kind>:<sourceId>". */
  id: string;
  prKey: PrKey;
  kind: EventKind;
  actor: string;
  isBot: boolean;
  at: IsoTime;
  /** One line for the UI, e.g. "alice asked: can you check the migration?" */
  summary: string;
  url: string | null;
  /** Id of the comment, review, commit or timeline item this came from. */
  sourceId: string;
  ruleLoudness: Loudness;
  ruleReason: string;
  override: LoudnessOverride | null;
  seenAt: IsoTime | null;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type PingReason = NotificationReason;

/**
 * How the full sync found a PR that is not in the inbox:
 * own_open: the viewer's own open PR; assigned: an open PR assigned to the
 * viewer, whoever opened it (a bot's is theirs, see `prOwners`);
 * review_requested: a review is asked of the viewer; team_review_requested:
 * of one of their teams; involved_merged: involves the viewer and merged in
 * the last days.
 */
export type FoundVia = 'own_open' | 'assigned' | 'review_requested' | 'team_review_requested' | 'involved_merged';

/**
 * Why a PR is inside a tile.
 * pinged: GitHub notified the user about it.
 * found: not in the inbox; the full sync found it through GitHub search
 *   (own open PRs, review requests, recently merged ones involving the
 *   user). Works like pinged for tiles, topics and queues, but never makes
 *   a tile unread on its own.
 * pulled_in: fetched only to complete a stack of a pinged PR ("stack layer below #N").
 */
export type Provenance =
  | { kind: 'pinged'; reason: PingReason }
  | { kind: 'found'; via: FoundVia; reason: string }
  | { kind: 'pulled_in'; reason: string };

/** A PR the full sync found, stored until the next sync finds a new list. */
export interface FoundPr {
  prKey: PrKey;
  via: FoundVia;
  /** "your open PR", "review requested from you", "review requested from acme/team-platform", "involves you, merged 2026-09-24". */
  reason: string;
  foundAt: IsoTime;
}

/**
 * A PR the sync fetched only to complete a stack, found by branch without
 * the agent. Provenance stays derived: once it gets its own notification it
 * counts as pinged. Until then it gets no glance, no topic assignment and no
 * dossier work; it shows in the topic of its anchor.
 */
export interface PullIn {
  prKey: PrKey;
  /** The pinged PR whose stack it completes. */
  anchorPrKey: PrKey;
  /** "stack layer below #1902" / "stack layer above #1902". */
  reason: string;
  pulledAt: IsoTime;
}

// ---------------------------------------------------------------------------
// Topics, sets, stacks, tiles
// ---------------------------------------------------------------------------

export type UserRole = 'driver' | 'reviewer' | 'stakeholder' | 'watcher';

/** archived: merged away, never comes back. retired: finished, comes back when a new PR joins. */
export type TopicStatus = 'active' | 'archived' | 'retired';

export interface Topic {
  /** Stable id, never reused. Renames keep the id. */
  id: string;
  name: string;
  /** Agent-written. */
  summary: string;
  summaryInputHash: string | null;
  /** User-confirmed per-topic instructions. Empty string when none. */
  tailoring: string;
  /** Login of whoever drives the topic, if known. */
  driver: string | null;
  userRole: UserRole;
  status: TopicStatus;
  /** When it retired; null unless retired. Only `nextTopicStatus` sets it. */
  retiredAt: IsoTime | null;
  /** Broad area the topic sits in ("CI", "Dev env"), agent-assigned. Null until the first dossier update. */
  area: string | null;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

export type AssignedBy = 'agent' | 'user';

export interface TopicMembership {
  prKey: PrKey;
  topicId: string;
  assignedBy: AssignedBy;
  reason: string;
  createdAt: IsoTime;
}

/** split: move prKeys out of topicId into a new topic called name. One proposal per new part. */
export type TopicProposalKind = 'new_topic' | 'rename' | 'merge' | 'split' | 'area_merge';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';
/** Who filed a topic proposal: the consolidation job, or an outside agent through the MCP server (propose_topic_change). */
export type ProposalSource = 'consolidation' | 'agent';

/** Topic changes are never applied silently. The agent proposes, the user decides. */
export interface TopicProposal {
  id: string;
  kind: TopicProposalKind;
  /** new_topic: null. rename/merge: the topic being changed. */
  topicId: string | null;
  /** new_topic/rename/split: the proposed name. */
  name: string | null;
  /** merge: the topic to merge into. */
  intoTopicId: string | null;
  /** area_merge: the area folded into `name`. topicId is null. */
  fromArea: string | null;
  /** new_topic: the PRs that triggered it. split: the PRs to move. */
  prKeys: PrKey[];
  reason: string;
  status: ProposalStatus;
  createdAt: IsoTime;
  decidedAt: IsoTime | null;
  source: ProposalSource;
  /** agent: the MCP client's name from its initialize handshake ("claude-code"); null for consolidation. */
  client: string | null;
}

export type PrSetStatus = 'active' | 'dissolved';

export interface PrSetMember {
  prKey: PrKey;
  /** Why the agent thinks this PR belongs to the set. Doubles as the pull-in reason. */
  reason: string;
}

/** Agent-grouped related PRs inside a topic that are not stacked in git. */
export interface PrSet {
  id: string;
  topicId: string;
  title: string;
  /** The agent's combined take on the set. */
  take: string;
  members: PrSetMember[];
  /**
   * PRs the user said are "not related" to this set. Kept so a regroup never
   * puts them back together with the remaining members.
   */
  removedKeys: PrKey[];
  status: PrSetStatus;
  inputHash: string;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

/** A real stack, derived from base/head refs. Never stored, always recomputed. */
export interface Stack {
  /** "stack:<bottom prKey>" */
  id: string;
  repo: string;
  /** Bottom (closest to the default branch) first. */
  prKeys: PrKey[];
}

export type TileKind = 'single' | 'stack' | 'set';

export interface TileMember {
  prKey: PrKey;
  provenance: Provenance;
}

/**
 * A stack inside a tile, so the UI can draw it as one: which members form
 * it and in which order. Every key is also in the tile's members.
 */
export interface TileStack {
  /** The Stack id: "stack:<bottom prKey>". */
  id: string;
  /** Bottom (closest to the default branch) first; layer n is prKeys[n]. */
  prKeys: PrKey[];
}

/**
 * The unit of attention inside a topic. Composition is derived on every read:
 * single = "pr:<prKey>", stack = Stack.id, set = "set:<PrSet.id>".
 * A tile only exists if at least one member is pinged.
 */
export interface Tile {
  id: string;
  topicId: string;
  kind: TileKind;
  title: string;
  /** Stack order for stacks, set order for sets, one entry for singles. */
  members: TileMember[];
  /**
   * The stacks among the members: one for a stack tile, one per stack a set
   * holds (in the order they appear), none for a single.
   */
  stacks: TileStack[];
}

export type TileStateKind = 'unread' | 'open' | 'done' | 'snoozed';

/**
 * Why a tile is unread: one of its PRs' threads is unread on GitHub
 * (DESIGN.md "GitHub unread is PostPile unread"). Each unseen loud event of
 * that PR is a reason; with none, its newest unseen quiet event is; with
 * none either, the thread itself ("new activity on GitHub", `eventId`
 * `thread:<thread id>`, the newest event's kind and actor). A pulled-in
 * layer's loud news and an unseen Look closer event are reasons too.
 */
export interface UnreadReason {
  prKey: PrKey;
  eventId: string;
  kind: EventKind;
  /** Who did it, so the UI can show their avatar. */
  actor: string;
  summary: string;
  /** When the event happened, so the UI can say how long it has waited. */
  at: IsoTime;
}

/** Derived, never stored. */
export interface TileState {
  kind: TileStateKind;
  /** Non-empty only when kind is unread: which PR and which event. */
  unreadBecause: UnreadReason[];
  /**
   * Only when kind is open: merges without the user's review they have not
   * seen, oldest first, for the tile's quiet grey strip. Absent means none.
   */
  unseenMerges?: UnreadReason[];
  /**
   * A tracked thread of the tile is unread on GitHub. True on every unread
   * tile, and on a snoozed tile whose thread is unread: it keeps its snooze
   * but counts in the Unread filter and the unread counts.
   */
  unreadOnGitHub: boolean;
  /**
   * A member (not a found PR) has an unseen loud event. Pings, the coral
   * "new since you looked", urgency and sections follow loud news, not
   * unread: a tile unread with only quiet news pings nothing.
   */
  loud: boolean;
}

// ---------------------------------------------------------------------------
// Glance
// ---------------------------------------------------------------------------

export type Verdict = 'LOOKS_SAFE' | 'LOOK_CLOSER' | 'NOT_YOURS';

/** A file the agent says a reviewer should open first, with why in a few words. */
export interface KeyFile {
  /** One of the PR's changed files, exactly as GitHub lists it. */
  path: string;
  why: string;
}

/** The agent's per-PR "approve at a glance" summary. */
export interface Glance {
  prKey: PrKey;
  verdict: Verdict;
  /** One or two sentences written against the user's own instructions. */
  forYou: string;
  does: string;
  risk: string;
  othersSaid: string;
  /** Up to 3 changed files to open first; empty for trivial PRs and older glances. */
  keyFiles: KeyFile[];
  /** Only for pulled-in PRs. */
  pullInReason: string | null;
  /** Dossier version the glance was read against. Null for v1 glances and Unsorted. */
  dossierVersion: number | null;
  inputHash: string;
  model: string;
  createdAt: IsoTime;
}

// ---------------------------------------------------------------------------
// User state, snooze, feedback, chat
// ---------------------------------------------------------------------------

/** What the user did with a PR in this app. Separate from GitHub's read state. */
export interface UserPrState {
  prKey: PrKey;
  approvedAt: IsoTime | null;
  /** Head commit at approval time, so later pushes can be detected. */
  approvedCommitOid: string | null;
  /** Marked read / handled in the app. */
  handledAt: IsoTime | null;
}

export type SnoozeCondition =
  | { kind: 'someone_replies' }
  | { kind: 'new_push' }
  | { kind: 'ci_green' }
  | { kind: 'until_time'; until: IsoTime };

/**
 * One PR put away for later. A tile's snooze is one of these per tracked PR,
 * all with the same condition, so it survives the PR joining a stack or set.
 */
export interface Snooze {
  prKey: PrKey;
  condition: SnoozeCondition;
  /** Events and pushes are compared against this. */
  since: IsoTime;
}

export type FeedbackKind =
  | 'not_mine'
  | 'not_related'
  | 'wrong_topic'
  | 'unmute'
  | 'tailoring_kept'
  | 'tailoring_once'
  /** A fact or dossier line the user marked wrong. The note holds the line. */
  | 'memory_wrong'
  /** A "what you care about" line the user asked to forget. The note holds the line. */
  | 'memory_forget'
  /** The user accepted a recheck that found the line still right: keep it. The note holds the line. */
  | 'memory_confirmed'
  /** The user accepted a recheck's corrected line. The note is fixedClaimNote(). */
  | 'memory_fixed'
  /** A thread of the "what you're working on" digest the user asked to forget. The note holds its title, then its detail. */
  | 'work_context_forget';

/** A user correction. The newest few per topic go back into prompts. */
export interface Feedback {
  id: number;
  kind: FeedbackKind;
  topicId: string | null;
  tileId: string | null;
  prKey: PrKey | null;
  setId: string | null;
  eventId: string | null;
  note: string;
  createdAt: IsoTime;
}

export type ChatRole = 'user' | 'agent';

export interface ChatMessage {
  id: number;
  tileId: string;
  topicId: string;
  role: ChatRole;
  text: string;
  createdAt: IsoTime;
}

/**
 * A lasting point the agent spotted in the user's chat message. The user
 * picks where it goes: "Keep for this topic" (tailoring), "Keep for all
 * topics" (an instructions proposal from the same message) or "Just this once".
 */
export interface LastingPointProposal {
  /** The tile's topic. Null on Unsorted, which has no tailoring to keep it in. */
  topicId: string | null;
  text: string;
  /** The user's own chat message it came from. Instructions proposals only ever start from one. */
  sourceChatMessageId: number;
}
