// Builds the "Why?" panel of a fact or dossier line from stored snapshots.
// Pure: the engine and the fake engine hand in what they have stored.

import { clipText } from './dossier.ts';
import { parsePrKey } from './keys.ts';
import type { Fact, FactRef, LineSources, StaleReason, UserRef, VerifyOutcome } from './memory.ts';
import type { MemoryCheck, MemorySource } from './memory-views.ts';
import type { Comment, Pr, PrEvent, PrKey, ReviewState } from './types.ts';

const EXCERPT = 240;

const REVIEW_WORDS: Record<ReviewState, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes on',
  COMMENTED: 'reviewed',
  DISMISSED: 'had a dismissed review on',
  PENDING: 'started a review on',
};

function number(prKey: PrKey): string {
  try {
    return `#${parsePrKey(prKey).number}`;
  } catch {
    return prKey;
  }
}

function findComment(pr: Pr, id: string): Comment | undefined {
  return pr.comments.find((comment) => comment.id === id) ?? pr.threads.flatMap((thread) => thread.comments).find((comment) => comment.id === id);
}

function gone(ref: FactRef, what: string): MemorySource {
  return { kind: ref.kind, who: null, title: `${what} on ${number(ref.prKey)}, no longer there`, excerpt: '', at: ref.at, url: ref.url, missing: true };
}

function describeComment(ref: FactRef, pr: Pr): MemorySource {
  const comment = ref.sourceId ? findComment(pr, ref.sourceId) : undefined;
  if (!comment) {
    return gone(ref, 'A comment');
  }
  const where = comment.path ? ` on ${comment.path} in ` : ' on ';
  return {
    kind: ref.kind,
    who: comment.author,
    title: `commented${where}${number(ref.prKey)}`,
    excerpt: clipText(comment.body, EXCERPT),
    at: comment.createdAt,
    url: comment.url || ref.url,
    missing: false,
  };
}

function describeReview(ref: FactRef, pr: Pr): MemorySource {
  const review = pr.reviews.find((candidate) => candidate.id === ref.sourceId);
  if (!review) {
    return gone(ref, 'A review');
  }
  const title = `${REVIEW_WORDS[review.state]} ${number(ref.prKey)}`;
  return { kind: ref.kind, who: review.author, title, excerpt: clipText(review.body, EXCERPT), at: review.submittedAt, url: ref.url, missing: false };
}

function describeCommit(ref: FactRef, pr: Pr): MemorySource {
  const commit = pr.commits.find((candidate) => candidate.oid === ref.sourceId);
  if (!commit) {
    return gone(ref, 'A commit');
  }
  const title = `pushed ${commit.oid.slice(0, 7)} to ${number(ref.prKey)}`;
  return { kind: ref.kind, who: commit.author, title, excerpt: clipText(commit.headline, EXCERPT), at: commit.committedAt, url: ref.url, missing: false };
}

function describeEvent(ref: FactRef, events: PrEvent[]): MemorySource {
  const event = events.find((candidate) => candidate.id === ref.sourceId);
  if (!event) {
    return gone(ref, 'An event');
  }
  return { kind: ref.kind, who: event.actor, title: `${event.kind.replaceAll('_', ' ')} on ${number(ref.prKey)}`, excerpt: clipText(event.summary, EXCERPT), at: event.at, url: event.url ?? ref.url, missing: false };
}

/** A GitHub ref as a readable source. events are the stored events of the ref's PR. */
export function describeFactRef(ref: FactRef, pr: Pr | undefined, events: PrEvent[]): MemorySource {
  if (pr === undefined) {
    return { kind: ref.kind, who: null, title: `${number(ref.prKey)}, not synced`, excerpt: '', at: ref.at, url: ref.url, missing: true };
  }
  if (ref.kind === 'comment') {
    return describeComment(ref, pr);
  }
  if (ref.kind === 'review') {
    return describeReview(ref, pr);
  }
  if (ref.kind === 'commit') {
    return describeCommit(ref, pr);
  }
  if (ref.kind === 'event') {
    return describeEvent(ref, events);
  }
  return { kind: 'pr', who: pr.author, title: `opened ${number(ref.prKey)}`, excerpt: pr.title, at: pr.createdAt, url: pr.url, missing: false };
}

const USER_TITLES: Record<UserRef['kind'], (ref: UserRef) => string> = {
  instructions: (ref) => `Your instructions, version ${ref.id}`,
  tailoring: () => 'Your instructions for this topic',
  feedback: () => 'Your correction',
  chat: () => 'You said in chat',
};

export function describeUserRef(ref: UserRef): MemorySource {
  return { kind: ref.kind, who: null, title: USER_TITLES[ref.kind](ref), excerpt: ref.quote, at: ref.at, url: null, missing: false };
}

/** Every source of a line, oldest first. */
export function describeLineSources(sources: LineSources, prs: Map<PrKey, Pr>, events: Map<PrKey, PrEvent[]>): MemorySource[] {
  const github = sources.refs.map((ref) => describeFactRef(ref, prs.get(ref.prKey), events.get(ref.prKey) ?? []));
  const user = sources.userRefs.map(describeUserRef);
  return [...github, ...user].sort((a, b) => a.at.localeCompare(b.at));
}

/** Verify state of a dossier line: its failing check if any, else what backs it. */
export function lineCheck(sources: LineSources, issue: StaleReason | null): MemoryCheck {
  if (issue !== null) {
    return { state: 'stale', reason: issue, note: null };
  }
  if (sources.refs.length > 0) {
    return { state: 'ok', reason: null, note: null };
  }
  return { state: sources.userRefs.length > 0 ? 'user_only' : 'unsourced', reason: null, note: null };
}

/** Verify state of a fact: closed beats a failing check, which beats the stored stale mark. */
export function factCheck(fact: Fact, outcome: VerifyOutcome): MemoryCheck {
  if (fact.invalidAt !== null || fact.expiredAt !== null) {
    return { state: 'closed', reason: null, note: fact.invalidReason };
  }
  if (outcome.kind !== 'ok') {
    return { state: 'stale', reason: outcome.reason, note: null };
  }
  if (fact.staleReason !== null) {
    return { state: 'stale', reason: fact.staleReason, note: null };
  }
  return { state: fact.refs.length > 0 ? 'ok' : 'unsourced', reason: null, note: null };
}
