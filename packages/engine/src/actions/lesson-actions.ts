import type { AgentService } from '@postpile/agent';
import { lessonGlance, type ActionResult, type Lesson, type LessonView, type PrKey, type TeachLessonResult } from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import { checkOpenLesson } from '../lessons/lesson-check.ts';
import { LessonWriter } from '../lessons/lesson-writer.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { ChatActions } from './chat-actions.ts';
import { failed, ok } from './results.ts';

/** "Teach future assessments" per rolling 24 hours. Each is one sonnet call. */
export const TAUGHT_PER_DAY = 30;
/** Longest note the user can type. */
export const TEACH_NOTE_MAX = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lessons the user decides on (DESIGN.md "Lessons from your reviews"): the
 * open ones in a topic, "Teach future assessments" in the detail pane,
 * "Remember in this topic" and "Dismiss". "Use across topics" goes through
 * InstructionsActions.proposeFromLesson and saveInstructions.
 */
export class LessonActions {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly chats: ChatActions,
    private readonly now: () => Date,
    private readonly agentOff: () => string | null,
  ) {}

  private view(lesson: Lesson, joined: number): LessonView {
    const pr = this.store.prs.get(lesson.prKey);
    return {
      id: lesson.id,
      topicId: lesson.topicId,
      prKey: lesson.prKey,
      prNumber: pr?.ref.number ?? 0,
      prTitle: pr?.title ?? lesson.prKey,
      source: lesson.source,
      mismatch: lesson.mismatch,
      text: lesson.text,
      earlierVerdict: lesson.glance?.verdict ?? null,
      reviews: lesson.source === 'review' ? 1 + joined : joined,
      createdAt: lesson.createdAt,
    };
  }

  /** The topic's open lessons, oldest first. */
  list(topicId: string): LessonView[] {
    const open = this.store.lessons.listOpenForTopic(topicId);
    const joined = this.store.lessons.joinedCounts(open.map((lesson) => lesson.id));
    return open.map((lesson) => this.view(lesson, joined.get(lesson.id) ?? 0));
  }

  private overDailyCap(): boolean {
    const since = new Date(this.now().getTime() - DAY_MS).toISOString();
    return this.store.lessons.countTaughtSince(since) >= TAUGHT_PER_DAY;
  }

  /**
   * "Teach future assessments": the user's note on a PR becomes a lesson,
   * and the agent writes its line right away. The lesson is open (or joins
   * one already open) like one from a review; the user still picks where it
   * applies. When the call fails the lesson stays new and the next sync
   * writes it.
   */
  async teach(prKey: PrKey, note: string): Promise<TeachLessonResult> {
    const text = note.trim();
    if (text === '') {
      return { lesson: null, reply: 'Say what it should check next time.' };
    }
    if (text.length > TEACH_NOTE_MAX) {
      return { lesson: null, reply: `Keep it under ${TEACH_NOTE_MAX} characters.` };
    }
    if (!this.store.prs.get(prKey)) {
      return { lesson: null, reply: `No PR ${prKey}.` };
    }
    const off = this.agentOff();
    if (off !== null) {
      return { lesson: null, reply: off };
    }
    if (this.overDailyCap()) {
      return { lesson: null, reply: `Already ${TAUGHT_PER_DAY} lessons taught in the last 24 hours, the daily cap.` };
    }
    const viewer = loadViewer(this.store);
    if (viewer === null) {
      return { lesson: null, reply: 'Sync once first, so PostPile knows who you are.' };
    }
    const glance = this.store.glances.get(prKey);
    const topicId = this.store.memberships.get(prKey)?.topicId ?? null;
    const lesson = this.store.lessons.add({
      topicId,
      prKey,
      source: 'taught',
      mismatch: null,
      glance: glance ? lessonGlance(glance) : null,
      review: null,
      note: text,
      text: '',
      why: '',
      joinedId: null,
      status: 'new',
      createdAt: this.now().toISOString(),
      decidedAt: null,
    });
    try {
      await new LessonWriter(this.store, this.agent, this.contexts, viewer).write(topicId, [lesson]);
    } catch (error) {
      return { lesson: null, reply: `Could not write the lesson now (${errorText(error)}). The next sync tries again.` };
    }
    return this.teachResult(lesson.id);
  }

  private teachResult(id: number): TeachLessonResult {
    const written = this.store.lessons.get(id);
    if (!written || written.status === 'new') {
      return { lesson: null, reply: 'The agent did not answer for this lesson. The next sync tries again.' };
    }
    if (written.status === 'joined' && written.joinedId !== null) {
      const open = this.store.lessons.get(written.joinedId);
      const joined = this.store.lessons.joinedCounts([written.joinedId]).get(written.joinedId) ?? 0;
      return { lesson: open ? this.view(open, joined) : null, reply: 'The same lesson is already waiting in this topic.' };
    }
    if (written.status === 'none') {
      return { lesson: null, reply: written.why || 'Nothing reusable to remember from this.' };
    }
    return { lesson: this.view(written, 0), reply: written.why };
  }

  /** "Remember in this topic": the line goes into the topic's own instructions, which every later glance there reads. */
  keepForTopic(id: number): ActionResult {
    const at = this.now().toISOString();
    const check = checkOpenLesson(this.store, id, at);
    if (!check.ok) {
      return failed(check.message);
    }
    if (check.lesson.topicId === null) {
      return failed('Its PR is not in a topic yet. Use it across topics, or wait for the next sync to sort it.');
    }
    const kept = this.chats.decideTailoring(check.lesson.topicId, check.lesson.text, true);
    if (!kept.ok) {
      return kept;
    }
    this.store.lessons.decide(id, 'kept_topic', '', at);
    return ok('Remembered in this topic');
  }

  /** "Dismiss": the line goes away and is not offered again, not even reworded. */
  dismiss(id: number): ActionResult {
    const lesson = this.store.lessons.get(id);
    if (!lesson || lesson.status !== 'open') {
      return failed('This lesson was already decided or withdrawn.');
    }
    this.store.lessons.decide(id, 'dismissed', '', this.now().toISOString());
    return ok('Dismissed');
  }
}
