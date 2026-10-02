import type { AgentService, LessonWriteAnswer, LessonWriteItem } from '@postpile/agent';
import { repeatsDismissed, type Lesson, type Viewer } from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import type { PromptContextSource } from '../prompt-context.ts';

/** Lessons in one call, so a busy topic does not grow one prompt without end. */
export const LESSONS_PER_CALL = 8;
/** Dismissed lines the agent is shown, newest first. */
export const DISMISSED_IN_PROMPT = 30;

/** Asks for one call; false when a budget said no. */
export type LessonCallAllowance = () => boolean;

function chunk<T>(items: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size));
  }
  return parts;
}

/**
 * Writes the line of each new lesson with one `lesson_write` call per
 * topic: open (a line to offer), none (no reusable lesson) or joined (the
 * same as a line already waiting). A line the user dismissed before reads
 * as none. Lessons the answer skipped stay new for the next run.
 */
export class LessonWriter {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly viewer: Viewer,
  ) {}

  private item(lesson: Lesson): LessonWriteItem | null {
    const pr = this.store.prs.get(lesson.prKey);
    if (!pr) {
      return null;
    }
    return { id: lesson.id, pr, source: lesson.source, mismatch: lesson.mismatch, glance: lesson.glance, review: lesson.review, note: lesson.note };
  }

  private apply(answers: LessonWriteAnswer[], dismissed: string[]): void {
    this.store.transaction(() => {
      for (const answer of answers) {
        if (answer.sameAs !== null) {
          this.store.lessons.setWritten(answer.id, { text: '', why: answer.why, status: 'joined', joinedId: answer.sameAs });
        } else if (answer.text === null) {
          this.store.lessons.setWritten(answer.id, { text: '', why: answer.why, status: 'none', joinedId: null });
        } else if (repeatsDismissed(answer.text, dismissed)) {
          this.store.lessons.setWritten(answer.id, { text: answer.text, why: 'The same line was turned down before.', status: 'none', joinedId: null });
        } else {
          this.store.lessons.setWritten(answer.id, { text: answer.text, why: answer.why, status: 'open', joinedId: null });
        }
      }
    });
  }

  /** One call for these lessons of one topic. Throws when the call fails. */
  async write(topicId: string | null, lessons: Lesson[]): Promise<void> {
    const items = lessons.map((lesson) => this.item(lesson)).filter((item) => item !== null);
    if (items.length === 0) {
      return;
    }
    // The prompt stays bounded; the check below reads every dismissal, so an old "no" still holds.
    const dismissed = this.store.lessons.listDismissedTexts(DISMISSED_IN_PROMPT);
    const open = topicId === null ? [] : this.store.lessons.listOpenForTopic(topicId).map((lesson) => ({ id: lesson.id, text: lesson.text }));
    const answers = await this.agent.writeLessons({
      topic: topicId === null ? null : this.store.topics.get(topicId),
      items,
      open,
      dismissed,
      viewer: this.viewer,
      context: this.contexts.forTopic(topicId),
    });
    this.apply(answers, this.store.lessons.listAllDismissedTexts());
  }

  /** Every new lesson, grouped by topic. Returns the errors; one failed call never stops the others. */
  async writeNew(allow: LessonCallAllowance): Promise<string[]> {
    const byTopic = new Map<string | null, Lesson[]>();
    for (const lesson of this.store.lessons.listNew()) {
      byTopic.set(lesson.topicId, [...(byTopic.get(lesson.topicId) ?? []), lesson]);
    }
    const errors: string[] = [];
    for (const [topicId, lessons] of byTopic) {
      for (const part of chunk(lessons, LESSONS_PER_CALL)) {
        if (!allow()) {
          return errors;
        }
        try {
          await this.write(topicId, part);
        } catch (error) {
          errors.push(`lessons for ${topicId ?? 'unsorted PRs'}: ${errorText(error)}`);
        }
      }
    }
    return errors;
  }
}
