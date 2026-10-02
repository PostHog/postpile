import type { LessonView, PrKey, TeachLessonResult } from '@postpile/core';
import { SampleClock, sampleKey } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

/** Same limit as the real engine's TEACH_NOTE_MAX. */
const TEACH_NOTE_MAX = 1000;
/** Same limit as core's LESSON_TEXT_MAX. */
const LESSON_TEXT_MAX = 200;
/** A note shorter than this many words has nothing the canned "agent" can reuse. */
const TEACH_MIN_WORDS = 3;

export interface FakeLessonsDeps {
  data: SampleData;
  now: () => Date;
  newId: () => number;
}

/** "Flag core imports from ee/." -> "Flag core imports from ee/". */
function withoutEndDot(text: string): string {
  return text.replace(/[.!\s]+$/, '');
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Lessons for FakeEngine, kept in memory (DESIGN.md "Lessons from your
 * reviews"): two open ones in the Depot topic, one from a review on a PR the
 * glance called Looks safe and one that two reviews backed. Teach makes a
 * canned line from the note; nothing is ever sent to an agent.
 */
export class FakeLessons {
  /** Open lessons only: a decision removes them. */
  private readonly lessons: LessonView[] = [];

  constructor(private readonly deps: FakeLessonsDeps) {
    const clock = new SampleClock(deps.now());
    this.lessons.push(
      this.sample(1904, {
        id: deps.newId(),
        source: 'review',
        mismatch: 'safety',
        text: 'When a PR narrows what Turbo hashes, say LOOK_CLOSER and name the inputs it drops.',
        reviews: 1,
        createdAt: clock.hoursAgo(5),
      }),
      this.sample(1921, {
        id: deps.newId(),
        source: 'review',
        mismatch: 'safety',
        text: 'When a version bump changes cache behaviour, say LOOK_CLOSER and name the cache it touches.',
        reviews: 2,
        createdAt: clock.hoursAgo(30),
      }),
    );
  }

  private prOf(prKey: PrKey) {
    return this.deps.data.prs.find((pr) => pr.key === prKey);
  }

  private earlierVerdict(prKey: PrKey): LessonView['earlierVerdict'] {
    return this.deps.data.glances.find((glance) => glance.prKey === prKey)?.verdict ?? null;
  }

  private sample(number: number, fields: Pick<LessonView, 'id' | 'source' | 'mismatch' | 'text' | 'reviews' | 'createdAt'>): LessonView {
    const prKey = sampleKey(number);
    return {
      ...fields,
      topicId: this.deps.data.membership.get(prKey) ?? null,
      prKey,
      prNumber: number,
      prTitle: this.prOf(prKey)?.title ?? prKey,
      earlierVerdict: this.earlierVerdict(prKey),
    };
  }

  /** The topic's open lessons, oldest first. */
  open(topicId: string): LessonView[] {
    return this.lessons.filter((lesson) => lesson.topicId === topicId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** An open lesson, or undefined once decided. */
  find(id: number): LessonView | undefined {
    return this.lessons.find((lesson) => lesson.id === id);
  }

  /** Decided (kept or dismissed): no longer offered. */
  close(id: number): void {
    const index = this.lessons.findIndex((lesson) => lesson.id === id);
    if (index >= 0) {
      this.lessons.splice(index, 1);
    }
  }

  /** Stand-in for the agent: the note becomes the line, a very short note is "nothing reusable". */
  teach(prKey: PrKey, note: string): TeachLessonResult {
    const text = note.trim();
    if (text === '') {
      return { lesson: null, reply: 'Say what it should check next time.' };
    }
    if (text.length > TEACH_NOTE_MAX) {
      return { lesson: null, reply: `Keep it under ${TEACH_NOTE_MAX} characters.` };
    }
    const pr = this.prOf(prKey);
    if (!pr) {
      return { lesson: null, reply: `No PR ${prKey}.` };
    }
    if (text.split(/\s+/).length < TEACH_MIN_WORDS) {
      return { lesson: null, reply: 'Nothing reusable to remember from this. Say what to check, for example a path or a kind of change.' };
    }
    const line = `${capitalized(withoutEndDot(text))}, and say LOOK_CLOSER when it applies.`;
    const lesson: LessonView = {
      id: this.deps.newId(),
      topicId: this.deps.data.membership.get(prKey) ?? null,
      prKey,
      prNumber: pr.ref.number,
      prTitle: pr.title,
      source: 'taught',
      mismatch: null,
      text: line.length > LESSON_TEXT_MAX ? `${line.slice(0, LESSON_TEXT_MAX - 1)}…` : line,
      earlierVerdict: this.earlierVerdict(prKey),
      reviews: 0,
      createdAt: this.deps.now().toISOString(),
    };
    this.lessons.push(lesson);
    return { lesson, reply: '' };
  }
}
