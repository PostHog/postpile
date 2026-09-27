import type { PrKey } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';

/** GitHub has no mark-unread API, so mark-read waits this long to allow a real undo. */
export const UNDO_WINDOW_MS = 6000;

export interface PendingBatch {
  token: string;
  threadIds: string[];
  prKeys: PrKey[];
  dueAt: number;
}

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Deferred mark-read with undo. enqueue returns a token; the GitHub call fires
 * after UNDO_WINDOW_MS unless undone. Batches stack, undo walks back newest
 * first. flush sends everything immediately (on quit). In memory only.
 */
export class MarkReadQueue {
  constructor(
    private readonly writer: GitHubWriter,
    private readonly timers: Timers,
    private readonly delayMs: number = UNDO_WINDOW_MS,
  ) {}

  enqueue(_threadIds: string[], _prKeys: PrKey[]): PendingBatch {
    throw new Error('not implemented');
  }

  /** Returns the undone batch, or null when nothing is pending (already sent). */
  undo(_token: string | null): PendingBatch | null {
    throw new Error('not implemented');
  }

  pending(): PendingBatch[] {
    throw new Error('not implemented');
  }

  flush(): Promise<void> {
    throw new Error('not implemented');
  }
}
