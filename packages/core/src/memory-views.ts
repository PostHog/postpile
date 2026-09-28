// Read models for engine memory v2, returned by EngineService and sent over the HTTP API.

import type {
  AgentCallStats,
  Dossier,
  DossierChange,
  DossierFlag,
  DossierIssue,
  EntityRef,
  Fact,
  FactPredicate,
  FactRefKind,
  RuleProposal,
  StaleReason,
  UserRefKind,
} from './memory.ts';
import type { IsoTime, TopicProposal } from './types.ts';

/** A fact plus the result of verify-before-use at read time. */
export interface FactView {
  fact: Fact;
  /** Null when the fact passed verification just now. */
  stale: StaleReason | null;
  /** A big claim (`isBigClaim`): role, decision, blocker, care. Only these get "Recheck". */
  recheckable: boolean;
}

/** What moved in a topic since the user last marked it seen. */
export interface TopicChanges {
  since: IsoTime;
  /** Dossier version the user saw last. Null when it had no dossier then. */
  fromVersion: number | null;
  /** recentChanges entries newer than `since`, newest first. */
  changes: DossierChange[];
  factsAdded: Fact[];
  factsClosed: Fact[];
  newEvents: number;
}

/** One stored dossier version and what it changed against the version before. */
export interface DossierVersionNote {
  version: number;
  createdAt: IsoTime;
  /** Short lines like "Status: active → blocked". Empty for the first version. */
  changes: string[];
}

export interface DossierView {
  version: number;
  createdAt: IsoTime;
  dossier: Dossier;
  flags: DossierFlag[];
  /** Claims that failed verify-before-use just now; the UI greys them out. */
  staleClaims: DossierIssue[];
  /** Null when the topic was never marked seen. */
  changesSinceSeen: TopicChanges | null;
  /** New events since this version was written: the dossier is behind until the next sync. */
  eventsBehind: number;
  /** Newest first, the latest version included. At most DOSSIER_HISTORY_SHOWN entries. */
  history: DossierVersionNote[];
  /** Lines the user marked wrong or asked to forget since this version was written. Matched by text. */
  correctedClaims: string[];
  /** Lines the user replaced with a recheck's fix since this version; shown fixed until the next update. */
  fixedClaims: FixedClaim[];
}

export interface FixedClaim {
  text: string;
  fixed: string;
}

/**
 * A memory_fixed feedback note holds both lines: the old one first, so the
 * prompt reads it as "this line -> that line", and the UI can split it again.
 */
const FIX_ARROW = '\n→ ';

export function fixedClaimNote(claim: FixedClaim): string {
  return `${claim.text}${FIX_ARROW}${claim.fixed}`;
}

/** Null for a note that was not written by fixedClaimNote. */
export function parseFixedClaimNote(note: string): FixedClaim | null {
  const split = note.indexOf(FIX_ARROW);
  if (split < 0) {
    return null;
  }
  return { text: note.slice(0, split), fixed: note.slice(split + FIX_ARROW.length) };
}

/** Filters for listFacts. Every field narrows; an empty query returns active facts, newest first. */
export interface FactQuery {
  /** Facts whose subject or object is this entity. */
  entity?: EntityRef;
  predicate?: FactPredicate;
  topicId?: string;
  /** Facts recorded or closed after this time ("what changed since T"). Closed ones count too. */
  changedSince?: IsoTime;
  /** Include invalidated and superseded facts. Default false, implied by changedSince. */
  includeClosed?: boolean;
  /** Default 100. */
  limit?: number;
}

export interface FactChangeCounts {
  added: number;
  updated: number;
  invalidated: number;
  /** Refs merged into an existing fact (NOOP). */
  confirmed: number;
  /** Marked stale by verify-before-use. */
  stale: number;
}

export interface ConsolidateOptions {
  /** Skip unless a run is due (24h since the last one and at least one new dossier version). */
  onlyIfDue?: boolean;
  /** Stop making agent calls after this many. */
  maxAgentCalls?: number;
}

export interface ConsolidationReport {
  startedAt: IsoTime;
  finishedAt: IsoTime;
  /** Set when the run did nothing: not due, or agent_off (claude missing, logged out or limited). */
  skipped: 'not_due' | 'agent_off' | null;
  topicProposalsFiled: number;
  ruleProposalsFiled: number;
  factsMerged: number;
  topicsRetired: number;
  agentCallStats: AgentCallStats;
  errors: string[];
}

/** Everything waiting for the user's decision, across topics. */
export interface PendingProposals {
  topics: TopicProposal[];
  rules: RuleProposal[];
}

/** What the user asked "Why?" about: a fact, or one line of a stored dossier version. */
export type MemoryTarget =
  | { kind: 'fact'; factId: string }
  /** path as in findDossierLine: "goal", "status", "openQuestions[2]", ... */
  | { kind: 'dossier_line'; topicId: string; version: number; path: string };

export type MemorySourceKind = FactRefKind | UserRefKind;

/** One source behind a fact or dossier line, ready to show. */
export interface MemorySource {
  kind: MemorySourceKind;
  /** GitHub login of who said or did it; null for the user's own words. */
  who: string | null;
  /** One short line: "commented on #1902", "Your instructions, version 3". */
  title: string;
  /** Short copy of the source text; empty when there is none. */
  excerpt: string;
  at: IsoTime;
  url: string | null;
  /** The source is gone from what the engine has stored: a deleted comment, a PR not synced. */
  missing: boolean;
}

/**
 * ok: checks out against GitHub now. stale: a check failed (reason says
 * which). closed: a fact the engine no longer believes (note says why).
 * user_only: only the user's own words back it, nothing on GitHub to check.
 * unsourced: no source recorded, e.g. a line from an older dossier version.
 */
export type MemoryCheckState = 'ok' | 'stale' | 'closed' | 'user_only' | 'unsourced';

export interface MemoryCheck {
  state: MemoryCheckState;
  reason: StaleReason | null;
  note: string | null;
}

/** The "Why?" panel of a fact or dossier line. */
export interface MemorySources {
  target: MemoryTarget;
  claim: string;
  /** "Fact" or "Dossier v3". */
  recordedIn: string;
  recordedAt: IsoTime;
  /** Oldest first. Empty means no source recorded. */
  sources: MemorySource[];
  check: MemoryCheck;
}
