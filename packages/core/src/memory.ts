// Engine memory v2: dossiers, facts, cursors and agent call accounting.
// Types only. DESIGN.md "Engine memory (v2)" explains how they fit together.

import type { Feedback, IsoTime, PrEvent, PrKey, ProposalStatus } from './types.ts';

// ---------------------------------------------------------------------------
// Event log and cursors
// ---------------------------------------------------------------------------

/**
 * A PR event plus its position in the append-only event log. seq grows by one
 * per first sighting and is never reused, so "everything after seq N" is exact
 * even for events whose GitHub time lies in the past (old commits, late fetches).
 */
export interface LoggedEvent {
  seq: number;
  event: PrEvent;
}

/**
 * digest: how far a topic's dossier has read the event log.
 * seen: how far the user had read a topic when they last marked it seen.
 * consolidate: how far the last consolidation run got (scope "global").
 * classify: how far the event second opinion got per topic ("unsorted" for
 * PRs without one).
 */
export type CursorKind = 'digest' | 'seen' | 'consolidate' | 'classify';

export interface Cursor {
  kind: CursorKind;
  /** Topic id, "unsorted" for classify, or "global" for consolidate. */
  scope: string;
  /** Last event_log seq covered. 0 means nothing yet. */
  seq: number;
  /** Dossier version current at that point, if any. */
  dossierVersion: number | null;
  updatedAt: IsoTime;
}

// ---------------------------------------------------------------------------
// Entities, facts, provenance
// ---------------------------------------------------------------------------

/**
 * What a fact can be about. Keys:
 * - person: GitHub login, lowercase
 * - path: "owner/repo:dir/prefix/" (a code area, trailing slash for directories)
 * - initiative: a topic id (one initiative per topic)
 * - pr: a PrKey
 */
export type EntityKind = 'person' | 'path' | 'initiative' | 'pr';

export interface EntityRef {
  kind: EntityKind;
  key: string;
}

export type FactPredicate =
  | 'drives'
  | 'works_on'
  | 'reviews'
  | 'owns'
  | 'part_of'
  | 'depends_on'
  | 'blocked_by'
  | 'decided'
  | 'status'
  | 'user_cares'
  | 'note';

export type FactRefKind = 'pr' | 'comment' | 'review' | 'commit' | 'event';

/** Where a fact or dossier claim came from. Every agent-made fact carries at least one. */
export interface FactRef {
  kind: FactRefKind;
  prKey: PrKey;
  /** Comment, review, commit or event id. Null for kind pr. */
  sourceId: string | null;
  url: string | null;
  /** When the source happened on GitHub. */
  at: IsoTime;
  /** PR head when the claim was made. Only set for claims about the code itself. */
  headOid: string | null;
}

export type FactSource = 'agent' | 'rule';

/**
 * A source in the user's own words rather than on GitHub: a version of the
 * general instructions, the topic tailoring, a correction, or a chat turn.
 */
export type UserRefKind = 'instructions' | 'tailoring' | 'feedback' | 'chat';

export interface UserRef {
  kind: UserRefKind;
  /** Instructions version, feedback id or chat message id as text; the topic id for tailoring. */
  id: string;
  at: IsoTime;
  /** Short copy of what the user said, so the source still reads after the tailoring changes or the chat is gone. */
  quote: string;
}

/** Where one dossier line came from: GitHub refs and the user's own words. */
export interface LineSources {
  refs: FactRef[];
  userRefs: UserRef[];
}

/**
 * One statement about an entity, bi-temporal:
 * validFrom / invalidAt say when it was true in the world,
 * recordedAt / expiredAt say when the engine believed it.
 * Facts are never deleted; they are closed out.
 */
export interface Fact {
  id: string;
  subject: EntityRef;
  predicate: FactPredicate;
  object: EntityRef | null;
  /** One sentence, shown to the user and fed back into prompts. */
  text: string;
  /** The topic whose dossier update produced it. */
  topicId: string | null;
  source: FactSource;
  refs: FactRef[];
  validFrom: IsoTime;
  invalidAt: IsoTime | null;
  invalidReason: string | null;
  /** Set when an UPDATE replaced this fact. */
  supersededBy: string | null;
  recordedAt: IsoTime;
  expiredAt: IsoTime | null;
  /** Set when verify-before-use failed; cleared when a refresh confirms or replaces it. */
  staleAt: IsoTime | null;
  staleReason: StaleReason | null;
  verifiedAt: IsoTime | null;
}

/** A fact the agent extracted, before it is reconciled against what is stored. */
export interface FactCandidate {
  subject: EntityRef;
  predicate: FactPredicate;
  object: EntityRef | null;
  text: string;
  refs: FactRef[];
  validFrom: IsoTime;
}

/** Mem0-style outcome of reconciling one candidate against stored facts. */
export type ReconcileAction =
  | { kind: 'add'; candidate: FactCandidate }
  | { kind: 'update'; factId: string; candidate: FactCandidate; reason: string }
  | { kind: 'invalidate'; factId: string; reason: string; at: IsoTime }
  | { kind: 'noop'; factId: string; refs: FactRef[] };

/** A candidate that deterministic rules could not settle; goes to reconcileFacts. */
export interface AmbiguousCandidate {
  candidate: FactCandidate;
  existing: Fact[];
}

export interface PreReconcileResult {
  actions: ReconcileAction[];
  ambiguous: AmbiguousCandidate[];
}

// ---------------------------------------------------------------------------
// Verify-before-use
// ---------------------------------------------------------------------------

export type StaleReason =
  | 'pr_missing'
  | 'pr_closed'
  | 'pr_merged'
  | 'head_moved'
  | 'person_not_involved'
  | 'source_deleted'
  | 'thread_resolved'
  /** Dossier timeline entry for a PR that is no longer a member of the topic. */
  | 'left_topic';

/**
 * ok: still good. invalidate: provably over (merged, closed), close it out at `at`.
 * stale: cannot be trusted any more, hide it and ask the next dossier update to recheck.
 */
export type VerifyOutcome =
  | { kind: 'ok' }
  | { kind: 'invalidate'; reason: StaleReason; at: IsoTime }
  | { kind: 'stale'; reason: StaleReason };

/** A dossier claim that failed verification. path points into the Dossier JSON. */
export interface DossierIssue {
  /** e.g. "openQuestions[2]" or "timeline[5]". */
  path: string;
  reason: StaleReason;
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

export type DossierStatus = 'starting' | 'active' | 'blocked' | 'winding_down' | 'finished';

export type DossierPersonRole = 'driver' | 'contributor' | 'reviewer' | 'stakeholder';

export interface DossierPerson {
  login: string;
  role: DossierPersonRole;
  note: string;
}

// The userRefs, refs on timeline entries and cares, and goalSources /
// statusSources are optional: versions stored before lines carried sources
// have none, and the UI shows "no source recorded" for them.

export interface DossierQuestion {
  text: string;
  askedBy: string | null;
  refs: FactRef[];
  userRefs?: UserRef[];
}

/**
 * What a PR does for the initiative. PR state, author and reviewers are not
 * stored here: they are read from the PR snapshot when rendering, so they can
 * never go stale.
 */
export interface DossierPrEntry {
  prKey: PrKey;
  role: string;
  refs?: FactRef[];
  userRefs?: UserRef[];
}

export type DossierCareSource = 'instructions' | 'tailoring' | 'feedback' | 'observed';

export interface DossierCare {
  text: string;
  source: DossierCareSource;
  refs?: FactRef[];
  userRefs?: UserRef[];
}

export interface DossierChange {
  at: IsoTime;
  text: string;
  refs: FactRef[];
  userRefs?: UserRef[];
}

/** The living, bounded document per topic. Limits in DOSSIER_LIMITS. */
export interface Dossier {
  goal: string;
  /** Mirrored into Topic.summary so list views keep working. */
  summary: string;
  status: DossierStatus;
  statusNote: string;
  goalSources?: LineSources;
  /** Sources of status and statusNote together. */
  statusSources?: LineSources;
  people: DossierPerson[];
  openQuestions: DossierQuestion[];
  /** Oldest first. PRs that roll off are folded into `earlier`. */
  timeline: DossierPrEntry[];
  earlier: string;
  userCares: DossierCare[];
  /** Newest first, rolling. */
  recentChanges: DossierChange[];
  /** Optional: versions stored before relations have none. */
  relation?: DossierRelation;
}

/**
 * How a topic relates to the user. team: their team drives it. routed:
 * another team owns it and the user (or their team) was pulled in for their
 * angle. fyi: they only follow along (subscribed, mentioned in passing).
 */
export type TopicRelation = 'team' | 'routed' | 'fyi';

export interface DossierRelation {
  kind: TopicRelation;
  /** "PostHog/team-devex", when known. */
  ownerTeam: string | null;
  /** Short: "team-devex review requested", "CODEOWNERS on .github/workflows", "subscribed". */
  whyYou: string;
  refs?: FactRef[];
  userRefs?: UserRef[];
}

export type DossierFlagKind = 'needs_user' | 'contradiction' | 'looks_finished' | 'off_topic_pr';

/** Something the dossier update wants the user or the consolidation job to look at. */
export interface DossierFlag {
  kind: DossierFlagKind;
  text: string;
  prKey: PrKey | null;
}

/** One stored dossier. Versions are kept so "what changed" has an answer. */
export interface DossierVersion {
  topicId: string;
  /** 1, 2, 3, ... per topic. */
  version: number;
  dossier: Dossier;
  flags: DossierFlag[];
  inputHash: string;
  /** Last event_log seq this version has read. */
  throughSeq: number;
  model: string;
  createdAt: IsoTime;
}

/**
 * The new input for one dossier update. Only what happened since the digest
 * cursor, never the full history.
 */
export interface TopicDelta {
  topicId: string;
  /** Digest cursor before this update. */
  fromSeq: number;
  /** Highest seq read, including events dropped by the size cap. The cursor moves here. */
  toSeq: number;
  /** New events on member PRs, oldest first, after the size cap. */
  events: PrEvent[];
  /** Events past the cap, only counted. */
  omittedEvents: number;
  /** Members the previous dossier does not know yet. They get a short intro in the prompt. */
  joinedPrKeys: PrKey[];
  /** PRs in the previous timeline that are no longer members. */
  leftPrKeys: PrKey[];
  /** Facts that failed verification and need a recheck. */
  staleFactIds: string[];
  /** Dossier claims that failed verification. */
  staleClaims: DossierIssue[];
  /** Feedback on this topic newer than the previous version. */
  newFeedback: Feedback[];
}

// ---------------------------------------------------------------------------
// Batched glances
// ---------------------------------------------------------------------------

/** One glance call: up to GLANCE_BATCH_SIZE PRs of one topic, read against its dossier. */
export interface GlanceBatch {
  /** Null for the virtual Unsorted topic. */
  topicId: string | null;
  dossierVersion: number | null;
  prKeys: PrKey[];
  /** 1 for the first round, 2 for the retry of missing or invalid answers. */
  attempt: 1 | 2;
}

// ---------------------------------------------------------------------------
// Consolidation and standing rules
// ---------------------------------------------------------------------------

/** A standing rule the consolidation job distilled from repeated feedback. Only applies once accepted. */
export interface RuleProposal {
  id: string;
  text: string;
  /** Null for a global rule; a topic id for a topic rule (accepting appends it to the tailoring). */
  topicId: string | null;
  evidenceFeedbackIds: number[];
  reason: string;
  status: ProposalStatus;
  createdAt: IsoTime;
  decidedAt: IsoTime | null;
}

// ---------------------------------------------------------------------------
// Agent call accounting
// ---------------------------------------------------------------------------

/** Every kind of agent call. The agent package uses this as AgentPurpose. */
export type AgentCallKind =
  | 'topic_assignment'
  | 'set_grouping'
  | 'dossier_update'
  | 'fact_reconcile'
  | 'glance_batch'
  | 'event_classification'
  | 'consolidation'
  | 'draft_comment'
  | 'chat'
  | 'instructions_change'
  /** "Recheck" on one memory line, asked by the user. */
  | 'memory_recheck'
  /** Should new activity from the fast poll ping the Mac? One call per poll cycle. */
  | 'ping_decision'
  /** The daily "what you're working on" digest from local Claude Code data. */
  | 'context_sweep';

/** One row per runner call, persisted in agent_call. */
export interface AgentCallRecord {
  /** Sync id, "consolidate:<time>", or "action" for chat and drafts. */
  runId: string;
  kind: AgentCallKind;
  topicId: string | null;
  model: string;
  ok: boolean;
  attempt: number;
  durationMs: number;
  costUsd: number | null;
  at: IsoTime;
}

export interface AgentCallCount {
  /** Calls made, including failed ones and retries. */
  calls: number;
  failed: number;
  /** Retry calls (glance_batch attempt 2). Already counted in calls. */
  retries: number;
  /** Work skipped because its input hash had not changed. Not a call. Per PR for glance_batch, per topic otherwise. */
  skippedUnchanged: number;
  /** Work skipped because the call cap was reached. Not a call. */
  skippedByBudget: number;
  durationMs: number;
  /** Null when the backend never reported a cost. */
  costUsd: number | null;
}

export interface AgentCallStats {
  /** Sum of calls over every kind. */
  total: number;
  byKind: Partial<Record<AgentCallKind, AgentCallCount>>;
}

export type AgentCallOutcome = 'ok' | 'failed' | 'skipped_unchanged' | 'skipped_by_budget';
