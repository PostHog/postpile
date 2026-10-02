import { describe, expect, it } from 'vitest';
import type { LessonView } from '@postpile/core';
import { earlierAssessmentText, lessonSourceText } from './lessons.ts';

function lesson(overrides: Partial<LessonView>): LessonView {
  return {
    id: 1,
    topicId: 'topic-a',
    prKey: 'acme/app#4521',
    prNumber: 4521,
    prTitle: 'Move billing models',
    source: 'review',
    mismatch: 'safety',
    text: 'When core imports from ee/, say LOOK_CLOSER and name the import.',
    earlierVerdict: 'LOOKS_SAFE',
    reviews: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('lessonSourceText', () => {
  it('names the review, or the reviews with how many more', () => {
    expect(lessonSourceText(lesson({}))).toBe('From your review on #4521');
    expect(lessonSourceText(lesson({ reviews: 2 }))).toBe('From your reviews on #4521 and 1 more');
  });

  it('names the note of a taught lesson, plus reviews that joined it', () => {
    expect(lessonSourceText(lesson({ source: 'taught', mismatch: null, reviews: 0 }))).toBe('From your note on #4521');
    expect(lessonSourceText(lesson({ source: 'taught', mismatch: null, reviews: 1 }))).toBe('From your note on #4521 and 1 more');
  });
});

describe('earlierAssessmentText', () => {
  it('words the verdict like the rest of the app', () => {
    expect(earlierAssessmentText(lesson({}))).toBe('Earlier assessment: Looks safe');
    expect(earlierAssessmentText(lesson({ earlierVerdict: 'NOT_YOURS' }))).toBe('Earlier assessment: Not yours');
    expect(earlierAssessmentText(lesson({ earlierVerdict: null }))).toBeNull();
  });
});
