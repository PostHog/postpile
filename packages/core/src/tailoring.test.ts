import { describe, expect, it } from 'vitest';
import { appendTailoring, lessonTailoringLine, mergedTailoringLines, removeTailoringLine, tailoringLines } from './tailoring.ts';

describe('tailoringLines', () => {
  it('splits on newlines and drops blank lines', () => {
    expect(tailoringLines('Only cache changes.\n\n  Flag runner labels.  \n')).toEqual(['Only cache changes.', 'Flag runner labels.']);
  });

  it('is empty for empty tailoring', () => {
    expect(tailoringLines('  ')).toEqual([]);
  });
});

describe('appendTailoring', () => {
  it('adds a line at the end', () => {
    expect(appendTailoring('One.', ' Two. ')).toBe('One.\nTwo.');
  });

  it('starts empty tailoring with the line', () => {
    expect(appendTailoring('', 'One.')).toBe('One.');
  });
});

describe('removeTailoringLine', () => {
  it('removes the first matching line only', () => {
    expect(removeTailoringLine('One.\nTwo.\nOne.', 'One.')).toBe('Two.\nOne.');
  });

  it('returns null when the line is not there', () => {
    expect(removeTailoringLine('One.', 'Three.')).toBeNull();
  });

  it('can empty the tailoring', () => {
    expect(removeTailoringLine('One.', ' One. ')).toBe('');
  });
});

describe('mergedTailoringLines', () => {
  it('prefixes each merged line with the topic it came from', () => {
    expect(mergedTailoringLines('Flag secrets.', 'Only cache changes.\nSkip docs.', 'Frontend build')).toEqual([
      'From Frontend build: Only cache changes.',
      'From Frontend build: Skip docs.',
    ]);
  });

  it('leaves out lines the target already holds', () => {
    expect(mergedTailoringLines('From Frontend build: Skip docs.', 'Skip docs.', 'Frontend build')).toEqual([]);
  });
});

describe('lessonTailoringLine', () => {
  it('names the review a lesson came from', () => {
    expect(lessonTailoringLine('review', 4521, 'When a migration drops a column, check the backfill.')).toBe(
      'From your review on #4521: When a migration drops a column, check the backfill.',
    );
  });

  it('names a taught note', () => {
    expect(lessonTailoringLine('taught', 12, 'When X, check Y.')).toBe('From your note on #12: When X, check Y.');
  });
});
