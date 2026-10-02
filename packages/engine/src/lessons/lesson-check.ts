import { reviewNow, type Lesson } from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer } from '../viewer-meta.ts';

export type LessonCheck = { ok: true; lesson: Lesson } | { ok: false; message: string };

/**
 * Before the user's decision lands: the lesson is still open, and its
 * review still says what the line was written from. An edited review starts
 * the candidate over, a deleted one withdraws it, like the sync would.
 */
export function checkOpenLesson(store: Store, id: number, at: string): LessonCheck {
  const lesson = store.lessons.get(id);
  if (!lesson) {
    return { ok: false, message: `No lesson ${id}.` };
  }
  if (lesson.status !== 'open') {
    return { ok: false, message: 'This lesson was already decided or withdrawn.' };
  }
  const pr = store.prs.get(lesson.prKey);
  const viewer = loadViewer(store);
  if (lesson.review === null || pr === null || viewer === null) {
    return { ok: true, lesson };
  }
  const now = reviewNow(lesson.review, pr, viewer);
  if (now.kind === 'edited') {
    store.lessons.restartFromReview(lesson.id, now.review);
    return { ok: false, message: 'The review it came from was edited. The line is written again on the next sync.' };
  }
  if (now.kind === 'deleted') {
    store.lessons.decide(lesson.id, 'withdrawn', 'The review it came from was deleted or dismissed.', at);
    return { ok: false, message: 'The review it came from was deleted or dismissed, so the lesson was withdrawn.' };
  }
  return { ok: true, lesson };
}

/** The PR and the review behind a lesson, as plain text for the instructions prompt (which fences it). */
export function lessonEvidence(store: Store, lesson: Lesson): string {
  const pr = store.prs.get(lesson.prKey);
  const lines = [`PR: ${lesson.prKey}${pr ? ` "${pr.title}"` : ''}`];
  if (lesson.review) {
    lines.push(`Review: ${lesson.review.body.trim() || '(no text in the review body)'}`);
    for (const comment of lesson.review.comments.slice(0, 8)) {
      lines.push(`- ${comment.path ?? '(no file)'}: ${comment.body}`);
    }
  }
  if (lesson.note.trim()) {
    lines.push(`The user's note: ${lesson.note.trim()}`);
  }
  return lines.join('\n');
}
