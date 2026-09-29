import type { IsoTime } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { GitHubWrites, WriteContext } from './github-writes.ts';

/**
 * What a guarded mark-read of one thread came to.
 * - already_read: gone, or read somewhere else in the meantime; nothing sent.
 *   `lastReadAt` is GitHub's read time, null when the thread is gone.
 * - moved: activity after the last sync; nothing sent, so it is not lost.
 * - off: writes were off at send time; nothing sent.
 * - sent: GitHub took it; the thread is read up to `readAt`.
 */
export type GuardedMarkRead =
  | { kind: 'already_read'; lastReadAt: IsoTime | null }
  | { kind: 'moved' }
  | { kind: 'off' }
  | { kind: 'sent'; readAt: IsoTime };

/**
 * The one guarded thread mark-read, shared by the deferred queue, pending
 * writes and quiet reads. A mark-read covers the whole thread on GitHub, so
 * the thread is read again first and left alone when it moved since the
 * sync. Each caller decides what an outcome means for it (log, mirror,
 * retry); a thrown error is GitHubWrites' logged failure.
 */
export async function markThreadReadIfUnchanged(
  reader: GitHubReader,
  writes: GitHubWrites,
  thread: { id: string; updatedAt: IsoTime },
  context: WriteContext,
): Promise<GuardedMarkRead> {
  const current = await reader.getThread(thread.id);
  if (current === null || !current.unread) {
    return { kind: 'already_read', lastReadAt: current?.lastReadAt ?? null };
  }
  if (current.updatedAt > thread.updatedAt) {
    return { kind: 'moved' };
  }
  if ((await writes.markThreadRead(thread.id, context)) === 'off') {
    return { kind: 'off' };
  }
  return { kind: 'sent', readAt: current.updatedAt };
}
