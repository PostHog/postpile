import type { DossierIssue, DossierVersion, Fact, LoggedEvent, TopicDelta } from './memory.ts';
import type { Feedback, PrKey } from './types.ts';

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
  /** Everything in the event log after cursorSeq for the member PRs, oldest first. */
  logged: LoggedEvent[];
  previous: DossierVersion | null;
  staleFacts: Fact[];
  staleClaims: DossierIssue[];
  /** Topic feedback, newest first. Only entries newer than previous.createdAt count as new. */
  feedback: Feedback[];
}

/**
 * Picks what a dossier update gets to read: new events (muted dropped, capped
 * by DELTA_LIMITS, bots kept since the prompt compacts them), members the
 * previous version does not know, members that left, stale facts and claims,
 * and new feedback. toSeq is the highest seq in `logged`, capped or not.
 */
export function selectTopicDelta(input: TopicDeltaInput): TopicDelta {
  throw new Error(`not implemented: selectTopicDelta (${input.topicId})`);
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
