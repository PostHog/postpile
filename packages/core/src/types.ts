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
  /** "org/team-slug" for every team the viewer belongs to. */
  teams: string[];
  /**
   * Every other login on those teams, fetched at most daily. Missing until
   * the first fetch (or in a viewer stored before it existed); rules then
   * fall back to treating any other reviewer as a teammate.
   */
  teamMembers?: string[];
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
  | 'bot_comment';

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
 * Why a PR is inside a tile.
 * pinged: GitHub notified the user about it.
 * pulled_in: fetched only to complete a stack of a pinged PR ("stack layer below #N").
 */
export type Provenance =
  | { kind: 'pinged'; reason: PingReason }
  | { kind: 'pulled_in'; reason: string };

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
  /** "stack layer below #41902" / "stack layer above #41902". */
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
}

export type TileStateKind = 'unread' | 'open' | 'done' | 'snoozed';

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
}

// ---------------------------------------------------------------------------
// Glance
// ---------------------------------------------------------------------------

export type Verdict = 'LOOKS_SAFE' | 'LOOK_CLOSER' | 'NOT_YOURS';

/** The agent's per-PR "approve at a glance" summary. */
export interface Glance {
  prKey: PrKey;
  verdict: Verdict;
  /** One or two sentences written against the user's own instructions. */
  forYou: string;
  does: string;
  risk: string;
  othersSaid: string;
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

export interface Snooze {
  tileId: string;
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
