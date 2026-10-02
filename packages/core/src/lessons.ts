import { glanceRiskLevel } from './glance-risk.ts';
import { sameLogin } from './mentions.ts';
import type { Glance, IsoTime, Pr, PrEvent, PrKey, Review, Viewer } from './types.ts';

// Lessons: what the agent should check next time, learned from the user's
// own pushback (DESIGN.md "Lessons from your reviews"). A review is
// evidence; only the user's click gives a lesson any say over later
// glances. Until then it is a candidate in the topic, nothing more.

/** A change request on a PR the glance let through (`review`), or the user's own words from the detail pane (`taught`). */
export type LessonSource = 'review' | 'taught';

/**
 * How the glance and the change request disagree. safety: it said Looks
 * safe. risk: it said Look closer but rated the risk low. relevance: it said
 * Not yours, yet the user reviewed and asked for changes.
 */
export type LessonMismatch = 'safety' | 'risk' | 'relevance';

/**
 * new: waits for the agent to write the line. open: shown in the topic.
 * none: the agent found no reusable lesson (nits, empty review). joined: the
 * same lesson as an open one, counted there as more evidence. kept_topic /
 * kept_all: the user kept it in the topic's tailoring or in instructions.md.
 * dismissed: the user said no. withdrawn: its source changed or its topic
 * is gone, before the user decided.
 */
export type LessonStatus = 'new' | 'open' | 'none' | 'joined' | 'kept_topic' | 'kept_all' | 'dismissed' | 'withdrawn';

/** What the glance said, kept when the lesson is noted; the glance row itself is replaced when the PR moves. */
export interface LessonGlance {
  verdict: Glance['verdict'];
  risk: string;
  forYou: string;
  does: string;
  createdAt: IsoTime;
  headOid: string | null;
}

/** One inline comment of the review, by the user. */
export interface LessonComment {
  path: string | null;
  body: string;
}

/** The user's change request: its body and their inline comments that went with it. */
export interface LessonReview {
  id: string;
  submittedAt: IsoTime;
  commitOid: string | null;
  body: string;
  comments: LessonComment[];
}

export interface Lesson {
  id: number;
  /** The PR's topic; null while the PR is unsorted. */
  topicId: string | null;
  prKey: PrKey;
  source: LessonSource;
  /** Null for taught lessons. */
  mismatch: LessonMismatch | null;
  /** The glance the user pushed back on; null when a taught lesson had none. */
  glance: LessonGlance | null;
  /** Null for taught lessons. */
  review: LessonReview | null;
  /** Taught lessons: the user's own words. Empty for review lessons. */
  note: string;
  /** The line to remember, as "when X, do Y". Empty until written, and for none. */
  text: string;
  /** The agent's reason for none, or why the lesson was withdrawn. */
  why: string;
  /** For joined: the open lesson it joined. */
  joinedId: number | null;
  status: LessonStatus;
  createdAt: IsoTime;
  decidedAt: IsoTime | null;
}

export type NewLesson = Omit<Lesson, 'id'>;

/** A change request the sync found, before it is stored. */
export interface PossibleMiss {
  prKey: PrKey;
  mismatch: LessonMismatch;
  glance: LessonGlance;
  review: LessonReview;
}

/** Statuses still waiting on the agent or the user. */
export const PENDING_LESSON_STATUSES: LessonStatus[] = ['new', 'open'];

/** Longest line the agent may keep; one instruction, not a paragraph. */
export const LESSON_TEXT_MAX = 200;
/** Lines an instructions change from a lesson may add. More is a rewrite, not one lesson. */
export const LESSON_ADDED_LINES_MAX = 4;
/** Characters an instructions change from a lesson may add. */
export const LESSON_ADDED_CHARS_MAX = 600;

export function isPendingLesson(status: LessonStatus): boolean {
  return PENDING_LESSON_STATUSES.includes(status);
}

/** The disagreement, or null when the glance had asked for a closer look at a real risk. */
export function lessonMismatch(glance: Glance): LessonMismatch | null {
  if (glance.verdict === 'LOOKS_SAFE') {
    return 'safety';
  }
  if (glance.verdict === 'NOT_YOURS') {
    return 'relevance';
  }
  return glanceRiskLevel(glance.risk) === 'low' ? 'risk' : null;
}

export function lessonGlance(glance: Glance): LessonGlance {
  return {
    verdict: glance.verdict,
    risk: glance.risk,
    forYou: glance.forYou,
    does: glance.does,
    createdAt: glance.createdAt,
    headOid: glance.headOid ?? null,
  };
}

/** When the user's review before this one was submitted, or null for their first. */
function previousReviewAt(pr: Pr, review: Review, viewer: Viewer): IsoTime | null {
  let previous: IsoTime | null = null;
  for (const other of pr.reviews) {
    if (other.id === review.id || !sameLogin(other.author, viewer.login) || other.submittedAt >= review.submittedAt) {
      continue;
    }
    if (previous === null || other.submittedAt > previous) {
      previous = other.submittedAt;
    }
  }
  return previous;
}

/**
 * The review and the user's inline comments that went with it. GitHub does
 * not link an inline comment to its review here, so the comments the user
 * wrote after their previous review and up to this one count. A change
 * request often says everything inline and nothing in its body.
 */
export function lessonReview(pr: Pr, review: Review, viewer: Viewer): LessonReview {
  const after = previousReviewAt(pr, review, viewer);
  const comments = pr.comments
    .filter(
      (comment) =>
        comment.kind === 'review_comment' &&
        sameLogin(comment.author, viewer.login) &&
        comment.createdAt <= review.submittedAt &&
        (after === null || comment.createdAt > after),
    )
    .map((comment) => ({ path: comment.path, body: comment.body }));
  return { id: review.id, submittedAt: review.submittedAt, commitOid: review.commitOid, body: review.body, comments };
}

/** The glance read another commit than the one the review is on: it never saw the code the user objected to. */
function judgedOtherCode(glance: Glance, review: Review): boolean {
  const glanceHead = glance.headOid ?? null;
  return glanceHead !== null && review.commitOid !== null && glanceHead !== review.commitOid;
}

/**
 * The viewer's new change requests on a PR whose glance, written before the
 * review and on the same code, let it through. Possible misses only: the
 * agent still decides whether the review holds a lesson worth keeping.
 */
export function possibleMisses(pr: Pr, newEvents: PrEvent[], glance: Glance | null, viewer: Viewer): PossibleMiss[] {
  if (glance === null) {
    return [];
  }
  const mismatch = lessonMismatch(glance);
  if (mismatch === null) {
    return [];
  }
  const misses: PossibleMiss[] = [];
  for (const event of newEvents) {
    if (event.kind !== 'review_changes_requested' || !sameLogin(event.actor, viewer.login)) {
      continue;
    }
    const review = pr.reviews.find((candidate) => candidate.id === event.sourceId);
    if (!review || review.submittedAt <= glance.createdAt || judgedOtherCode(glance, review)) {
      continue;
    }
    misses.push({ prKey: pr.key, mismatch, glance: lessonGlance(glance), review: lessonReview(pr, review, viewer) });
  }
  return misses;
}

function sameReviewText(a: LessonReview, b: LessonReview): boolean {
  if (a.body !== b.body || a.comments.length !== b.comments.length) {
    return false;
  }
  return a.comments.every((comment, index) => comment.path === b.comments[index]?.path && comment.body === b.comments[index]?.body);
}

/**
 * The stored review against the PR as it is now: unchanged, edited (body or
 * inline comments) or deleted. An edited source makes a new candidate; a
 * deleted one withdraws it.
 */
export function reviewNow(stored: LessonReview, pr: Pr, viewer: Viewer): { kind: 'same' } | { kind: 'edited'; review: LessonReview } | { kind: 'deleted' } {
  const review = pr.reviews.find((candidate) => candidate.id === stored.id);
  if (!review || review.state !== 'CHANGES_REQUESTED') {
    return { kind: 'deleted' };
  }
  const current = lessonReview(pr, review, viewer);
  return sameReviewText(stored, current) ? { kind: 'same' } : { kind: 'edited', review: current };
}

/** Lowercase words only, for "is this the same line" checks. */
export function normalizeLessonText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The line repeats one the user already dismissed. */
export function repeatsDismissed(text: string, dismissed: string[]): boolean {
  const normalized = normalizeLessonText(text);
  return normalized !== '' && dismissed.some((line) => normalizeLessonText(line) === normalized);
}

function lines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * An instructions change from one lesson may only add a few lines: every
 * line of the old text stays, in order, word for word. Anything else is a
 * rewrite the lesson never asked for. A hand edit in the diff is the user's
 * own and is not checked.
 */
export function onlyAddsLesson(before: string, after: string): boolean {
  const old = lines(before.trimEnd());
  const next = lines(after.trimEnd());
  const added: string[] = [];
  let index = 0;
  for (const line of next) {
    if (index < old.length && line === old[index]) {
      index += 1;
    } else {
      added.push(line);
    }
  }
  if (index < old.length && !(old.length === 1 && old[0] === '')) {
    return false;
  }
  const real = added.filter((line) => line.trim() !== '');
  const chars = real.reduce((sum, line) => sum + line.length, 0);
  return real.length > 0 && real.length <= LESSON_ADDED_LINES_MAX && chars <= LESSON_ADDED_CHARS_MAX;
}

/** A lesson as the topic marker and the detail pane show it. */
export interface LessonView {
  id: number;
  topicId: string | null;
  prKey: PrKey;
  prNumber: number;
  prTitle: string;
  source: LessonSource;
  mismatch: LessonMismatch | null;
  /** The line to remember. */
  text: string;
  /** What the glance said before the user pushed back; null when there was none. */
  earlierVerdict: Glance['verdict'] | null;
  /** This review plus the reviews that joined it. */
  reviews: number;
  createdAt: IsoTime;
}

/** "Teach future assessments": the line the agent made of the user's words, or why it made none. */
export interface TeachLessonResult {
  lesson: LessonView | null;
  reply: string;
}
