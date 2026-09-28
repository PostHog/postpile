import type { Store } from '@code-manager/store';

/** Forgotten threads handed to a sweep, newest first. Older ones have long dropped out of the digest. */
export const FORGOTTEN_IN_SWEEP = 50;

/** The feedback note of a Forget: the thread title, a newline, its detail. */
export function forgetNote(title: string, detail: string): string {
  return `${title}\n${detail}`;
}

/** Threads the user said Forget on, from the feedback log. */
export function forgottenThreads(store: Store): { title: string; detail: string }[] {
  return store.feedback.listByKind('work_context_forget', FORGOTTEN_IN_SWEEP).map((feedback) => {
    const [title = '', ...rest] = feedback.note.split('\n');
    return { title, detail: rest.join('\n') };
  });
}

/** Lowercased titles, the way forgotten threads are matched. */
export function forgottenTitles(store: Store): Set<string> {
  return new Set(forgottenThreads(store).map((thread) => thread.title.trim().toLowerCase()));
}
