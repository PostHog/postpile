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
  RuleProposal,
  StaleReason,
} from './memory.ts';
import type { IsoTime, TopicProposal } from './types.ts';

/** A fact plus the result of verify-before-use at read time. */
export interface FactView {
  fact: Fact;
  /** Null when the fact passed verification just now. */
  stale: StaleReason | null;
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
}

/** Filters for listFacts. Every field narrows; an empty query returns active facts, newest first. */
export interface FactQuery {
  /** Facts whose subject or object is this entity. */
  entity?: EntityRef;
  predicate?: FactPredicate;
  topicId?: string;
  /** Facts recorded or closed after this time ("what changed since T"). */
  changedSince?: IsoTime;
  /** Include invalidated and superseded facts. Default false. */
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
  /** Set when the run did nothing because it was not due. */
  skipped: 'not_due' | null;
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
