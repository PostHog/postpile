import type { LessonView } from '@postpile/core';
import { VERDICT_WORDS } from './glance.ts';

/** "From your review on" + "#4521" + " and 1 more": the PR number apart, so it can be set in mono. */
export interface LessonSource {
  before: string;
  pr: string;
  after: string;
}

/**
 * Where a lesson came from, under its line: "From your review on #4521",
 * "From your reviews on #4521 and 1 more", "From your note on #4521". A
 * taught lesson counts the reviews that joined it as more.
 */
export function lessonSource(lesson: LessonView): LessonSource {
  const pr = `#${lesson.prNumber}`;
  const more = lesson.source === 'taught' ? lesson.reviews : lesson.reviews - 1;
  const after = more > 0 ? ` and ${more} more` : '';
  if (lesson.source === 'taught') {
    return { before: 'From your note on ', pr, after };
  }
  return { before: more > 0 ? 'From your reviews on ' : 'From your review on ', pr, after };
}

/** The source as one line, for titles and tests. */
export function lessonSourceText(lesson: LessonView): string {
  const source = lessonSource(lesson);
  return `${source.before}${source.pr}${source.after}`;
}

/** "Earlier assessment: Looks safe", or null when the PR had no glance. */
export function earlierAssessmentText(lesson: LessonView): string | null {
  return lesson.earlierVerdict ? `Earlier assessment: ${VERDICT_WORDS[lesson.earlierVerdict]}` : null;
}
