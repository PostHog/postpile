import { effectiveLoudness } from './loudness.ts';
import type { DossierIssue, DossierVersion, Fact, LoggedEvent, TopicDelta } from './memory.ts';
import type { Feedback, PrEvent, PrKey } from './types.ts';

/** Bounds one dossier update. The first update of a big topic hits these; later ones rarely do. */
export const DELTA_LIMITS = {
  /** Events per update after dropping muted ones; the oldest go first. */
  maxEvents: 120,
  /** Newest events kept per PR when the cap bites, so one busy PR cannot crowd out the rest. */
  maxEventsPerPr: 15,
} as const;

export interface TopicDeltaInput {
  topicId: string;
  /** Digest cursor seq, 0 when the topic has no dossier yet. */
  cursorSeq: number;
  memberKeys: PrKey[];
  /** When each member joined the topic, for joinedMembers. Missing entries count as new. */
  memberSince: Map<PrKey, string>;
  /** Everything in the event log after cursorSeq for the member PRs, oldest first. */
  logged: LoggedEvent[];
  /**
   * Log entries of joined members (joinedMembers) at or before cursorSeq. A
   * PR that joins brings history the dossier never read: logged in an earlier
   * sync, while it sat in another topic, or interleaved with other PRs. It is
   * read once, together with the new events.
   */
  joinedHistory: LoggedEvent[];
  previous: DossierVersion | null;
  staleFacts: Fact[];
  staleClaims: DossierIssue[];
  /** Topic feedback, newest first. Only entries newer than previous.createdAt count as new. */
  feedback: Feedback[];
}

function isMuted(event: PrEvent): boolean {
  return effectiveLoudness(event) === 'muted';
}

function bySeq(a: LoggedEvent, b: LoggedEvent): number {
  return a.seq - b.seq;
}

/** Keeps the newest maxEventsPerPr events of each PR. Input and output are oldest first. */
function capPerPr(logged: LoggedEvent[]): LoggedEvent[] {
  const byPr = new Map<PrKey, LoggedEvent[]>();
  for (const entry of logged) {
    const list = byPr.get(entry.event.prKey) ?? [];
    list.push(entry);
    byPr.set(entry.event.prKey, list);
  }
  const kept = [...byPr.values()].flatMap((list) => list.slice(-DELTA_LIMITS.maxEventsPerPr));
  return kept.sort(bySeq);
}

/**
 * The size cap only bites when there are more than maxEvents: then each PR
 * keeps its newest maxEventsPerPr, and of those the newest maxEvents overall.
 */
function capEvents(logged: LoggedEvent[]): LoggedEvent[] {
  if (logged.length <= DELTA_LIMITS.maxEvents) {
    return logged;
  }
  return capPerPr(logged).slice(-DELTA_LIMITS.maxEvents);
}

/**
 * Members the previous dossier does not know yet: not in its timeline, and
 * joined after it was written. A PR that was already a member then was
 * offered once (the model left it out, or it rolled into `earlier`) and must
 * not force an update on every sync. Without a previous dossier every member
 * is new.
 */
export function joinedMembers(
  memberKeys: PrKey[],
  memberSince: Map<PrKey, string>,
  previous: DossierVersion | null,
): PrKey[] {
  const known = new Set(previous?.dossier.timeline.map((entry) => entry.prKey) ?? []);
  const previousAt = previous?.createdAt ?? null;
  return memberKeys.filter((key) => {
    const since = memberSince.get(key);
    return !known.has(key) && (previousAt === null || since === undefined || since > previousAt);
  });
}

/**
 * Picks what a dossier update gets to read: new events plus the history of
 * joined members (muted dropped, capped by DELTA_LIMITS, bots kept since the
 * prompt compacts them), members that joined after the previous version,
 * members that left, stale facts and claims, and new feedback. toSeq is the
 * highest seq in `logged`, capped or not.
 */
export function selectTopicDelta(input: TopicDeltaInput): TopicDelta {
  const members = new Set(input.memberKeys);
  const fresh = input.logged.filter((entry) => entry.seq > input.cursorSeq && members.has(entry.event.prKey));
  const toSeq = fresh.reduce((max, entry) => Math.max(max, entry.seq), input.cursorSeq);
  const joined = joinedMembers(input.memberKeys, input.memberSince, input.previous);
  const joinedKeys = new Set(joined);
  const history = input.joinedHistory.filter(
    (entry) => entry.seq <= input.cursorSeq && joinedKeys.has(entry.event.prKey),
  );
  const audible = [...history, ...fresh].sort(bySeq).filter((entry) => !isMuted(entry.event));
  const kept = capEvents(audible);
  const timelineKeys = new Set(input.previous?.dossier.timeline.map((entry) => entry.prKey) ?? []);
  const previousAt = input.previous?.createdAt ?? null;

  return {
    topicId: input.topicId,
    fromSeq: input.cursorSeq,
    toSeq,
    events: kept.map((entry) => entry.event),
    omittedEvents: audible.length - kept.length,
    joinedPrKeys: joined,
    leftPrKeys: [...timelineKeys].filter((key) => !members.has(key)),
    staleFactIds: input.staleFacts.map((fact) => fact.id),
    staleClaims: input.staleClaims,
    newFeedback: input.feedback.filter((entry) => previousAt === null || entry.createdAt > previousAt),
  };
}

/** Nothing new: no dossier update needed for this topic. */
export function isEmptyDelta(delta: TopicDelta): boolean {
  return (
    delta.events.length === 0 &&
    delta.omittedEvents === 0 &&
    delta.joinedPrKeys.length === 0 &&
    delta.leftPrKeys.length === 0 &&
    delta.staleFactIds.length === 0 &&
    delta.staleClaims.length === 0 &&
    delta.newFeedback.length === 0
  );
}
