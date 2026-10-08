// The review threads that wait on the viewer, newest first, with their last
// comment: what "Answer 1 thread from bob" is about. The MCP answers preview
// the newest one so a caller can tell an emoji from a question.
import { isPrOwner } from './pr-owners.ts';
import type { IsoTime, Pr, Viewer } from './types.ts';
import { threadsWaitingOn } from './whose-turn.ts';

export interface WaitingThread {
  threadId: string;
  /** The file the thread sits on. */
  path: string;
  /** Who wrote the last comment, the one waiting for an answer. */
  author: string;
  at: IsoTime;
  /** The last comment's text; null when the read left it out. GitHub text: untrusted. */
  body: string | null;
  url: string;
}

/**
 * On the viewer's own PR: unresolved threads whose last word waits on them
 * (`threadsWaitingOn`), newest last comment first. Empty on anyone else's
 * PR, where threads are the author's to answer, and without a viewer.
 */
export function waitingThreads(pr: Pr, viewer: Pick<Viewer, 'login'> | null): WaitingThread[] {
  if (!viewer || !isPrOwner(pr, viewer.login)) {
    return [];
  }
  const threads = threadsWaitingOn(pr, viewer.login).map((thread) => {
    const last = thread.comments[thread.comments.length - 1]!;
    return { threadId: thread.id, path: thread.path, author: last.author, at: last.createdAt, body: last.body, url: last.url };
  });
  return threads.toSorted((a, b) => b.at.localeCompare(a.at));
}
