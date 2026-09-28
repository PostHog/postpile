import { randomBytes } from 'node:crypto';
import {
  UNDO_WINDOW_MS,
  workContextPromptText,
  type ActionResult,
  type WorkContextView,
  type WorkThreadForget,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { forgetNote, forgottenTitles } from './forgotten.ts';
import type { WorkContextSweeper } from './sweeper.ts';

/**
 * Undo tokens of a Forget. The "memory:" start keeps the renderer from
 * counting them as pending mark-reads; the engine routes them here first.
 */
export const WORK_CONTEXT_UNDO_PREFIX = 'memory:workctx:';

interface ForgetUndo {
  feedbackId: number;
  until: number;
}

/**
 * Reads and user actions on the stored digest: the view for "What you're
 * working on", the compact text other prompts get, and Forget with Undo.
 * Forget only logs feedback; the next sweep is told to drop the thread, and
 * until then the thread is hidden from prompts and struck through in the UI.
 */
export class WorkContextMemory {
  private readonly undos = new Map<string, ForgetUndo>();

  constructor(
    private readonly store: Store,
    private readonly sweeper: WorkContextSweeper,
    private readonly now: () => Date,
  ) {}

  private topicNames(): Map<string, string> {
    return new Map(this.store.topics.list().map((topic) => [topic.id, topic.name]));
  }

  /** '' when no sweep has succeeded yet. */
  promptText(): string {
    const latest = this.store.workContext.latest();
    return latest ? workContextPromptText(latest, this.topicNames(), forgottenTitles(this.store)) : '';
  }

  view(): WorkContextView {
    const latest = this.store.workContext.latest();
    const error = this.sweeper.lastError();
    const running = this.sweeper.isRunning();
    // An error older than the newest version was fixed by that version.
    const lastError = error && (!latest || error.at >= latest.createdAt) ? error : null;
    const skip = this.sweeper.skipSettings();
    const skipFields = { skipPatterns: skip.patterns, skipSource: skip.source, skipConfigFile: skip.configFile };
    if (!latest) {
      return { current: null, lastError, running, ...skipFields };
    }
    const names = this.topicNames();
    const forgotten = forgottenTitles(this.store);
    return {
      current: {
        version: latest.version,
        createdAt: latest.createdAt,
        model: latest.model,
        summary: latest.digest.summary,
        lastSeenAt: latest.digest.lastSeenAt,
        inputStats: latest.inputStats,
        threads: latest.digest.threads.map((thread, index) => ({
          index,
          title: thread.title,
          detail: thread.detail,
          topics: thread.topicIds.flatMap((id) => {
            const name = names.get(id);
            return name === undefined ? [] : [{ id, name }];
          }),
          sources: thread.sources,
          forgotten: forgotten.has(thread.title.trim().toLowerCase()),
        })),
      },
      lastError,
      running,
      ...skipFields,
    };
  }

  forget(input: WorkThreadForget): ActionResult {
    const thread = this.store.workContext.get(input.version)?.digest.threads[input.index];
    if (!thread) {
      return { ok: false, message: 'That thread is gone; the digest changed meanwhile.', undoToken: null };
    }
    const feedback = this.store.feedback.add({
      kind: 'work_context_forget',
      topicId: null,
      tileId: null,
      prKey: null,
      setId: null,
      eventId: null,
      note: forgetNote(thread.title, thread.detail),
      createdAt: this.now().toISOString(),
    });
    const nowMs = this.now().getTime();
    for (const [token, entry] of this.undos) {
      if (entry.until <= nowMs) {
        this.undos.delete(token);
      }
    }
    const token = `${WORK_CONTEXT_UNDO_PREFIX}${randomBytes(6).toString('hex')}`;
    this.undos.set(token, { feedbackId: feedback.id, until: nowMs + UNDO_WINDOW_MS });
    return { ok: true, message: `Forgot "${thread.title}". The next sweep leaves it out.`, undoToken: token };
  }

  isUndo(token: string | null): boolean {
    return token !== null && token.startsWith(WORK_CONTEXT_UNDO_PREFIX);
  }

  undo(token: string): ActionResult {
    const entry = this.undos.get(token);
    this.undos.delete(token);
    if (!entry || entry.until <= this.now().getTime()) {
      return { ok: false, message: 'Too late to undo that.', undoToken: null };
    }
    this.store.feedback.delete(entry.feedbackId);
    return { ok: true, message: 'Undone.', undoToken: null };
  }
}
