import { possibleMisses, reviewNow, type FullPr, type IsoTime, type Viewer } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * The deterministic half of lessons (DESIGN.md "Lessons from your
 * reviews"): notes the user's change requests on PRs the glance let
 * through, keeps pending lessons in step with their source review, and
 * withdraws those whose topic is gone. No agent call; the LessonWriter
 * turns new lessons into lines.
 */
export class LessonKeeper {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /**
   * After a PR snapshot and its events are stored. Must run before the
   * glance is written again, which replaces the verdict the user pushed
   * back on. One lesson per review: a review seen again is skipped.
   */
  afterStorePr(pr: FullPr, createdIds: string[], viewer: Viewer): void {
    const at = this.now().toISOString();
    this.revalidate(pr, viewer, at);
    if (createdIds.length === 0) {
      return;
    }
    const created = new Set(createdIds);
    const newEvents = this.store.events.listForPr(pr.key).filter((event) => created.has(event.id));
    const misses = possibleMisses(pr, newEvents, this.store.glances.get(pr.key), viewer);
    const topicId = this.store.memberships.get(pr.key)?.topicId ?? null;
    for (const miss of misses) {
      if (this.store.lessons.hasReview(miss.review.id)) {
        continue;
      }
      this.store.lessons.add({
        topicId,
        prKey: pr.key,
        source: 'review',
        mismatch: miss.mismatch,
        glance: miss.glance,
        review: miss.review,
        note: '',
        text: '',
        why: '',
        joinedId: null,
        status: 'new',
        createdAt: at,
        decidedAt: null,
      });
    }
  }

  /**
   * A pending lesson, or one that joined an open line, follows its review:
   * an edit (body or inline comments) starts the candidate over from the
   * new text, a deleted or dismissed review withdraws it. What the user
   * already decided stays as it is.
   */
  private revalidate(pr: FullPr, viewer: Viewer, at: IsoTime): void {
    for (const lesson of this.store.lessons.listFollowingReviewForPr(pr.key)) {
      if (lesson.review === null) {
        continue;
      }
      const now = reviewNow(lesson.review, pr, viewer);
      if (now.kind === 'edited') {
        this.store.lessons.restartFromReview(lesson.id, now.review);
      } else if (now.kind === 'deleted') {
        this.store.lessons.withdraw(lesson.id, 'The review it came from was deleted or dismissed.', at);
      }
    }
  }

  /**
   * Once per digest: a pending lesson whose topic retired, was archived or
   * deleted is withdrawn; one noted while its PR was unsorted moves to the
   * PR's topic once it has one.
   */
  sweep(): void {
    const at = this.now().toISOString();
    const active = new Set(this.store.topics.listActive().map((topic) => topic.id));
    for (const lesson of this.store.lessons.listPending()) {
      if (lesson.topicId === null) {
        const topicId = this.store.memberships.get(lesson.prKey)?.topicId ?? null;
        if (topicId !== null && active.has(topicId)) {
          this.store.lessons.setTopic(lesson.id, topicId);
        }
        continue;
      }
      if (!active.has(lesson.topicId)) {
        this.store.lessons.withdraw(lesson.id, 'Its topic is no longer active.', at);
      }
    }
  }
}
