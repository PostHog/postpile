/** GitHub has no mark-unread API, so mark-read waits this long to allow a real undo. */
export const UNDO_WINDOW_MS = 6000;

/** Injectable clock, so tests can move time by hand. */
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DeferredBatch<T> {
  token: string;
  payload: T;
  /** Epoch ms when the batch gets sent. */
  dueAt: number;
}

export type SendBatch<T> = (payload: T) => Promise<void>;
export type SendFailed<T> = (error: unknown, batch: DeferredBatch<T>) => void;

export const systemTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry<T> {
  batch: DeferredBatch<T>;
  handle: unknown;
}

/**
 * Holds batches for a delay before sending them, so they can be undone.
 * Batches stack; undo without a token walks back newest first. flush sends
 * everything right away (on quit) instead of dropping it. In memory only.
 *
 * Generic over the payload so it has no GitHub dependency; the engine's
 * MarkReadQueue sends thread ids through a GitHubWriter.
 */
export class DeferredQueue<T> {
  private readonly entries: Entry<T>[] = [];
  private counter = 0;

  constructor(
    private readonly send: SendBatch<T>,
    private readonly timers: Timers,
    private readonly delayMs: number = UNDO_WINDOW_MS,
    private readonly onError: SendFailed<T> = () => {},
  ) {}

  private async sendNow(token: string): Promise<void> {
    const index = this.entries.findIndex((entry) => entry.batch.token === token);
    if (index < 0) {
      return;
    }
    const [entry] = this.entries.splice(index, 1);
    if (!entry) {
      return;
    }
    this.timers.clearTimeout(entry.handle);
    try {
      await this.send(entry.batch.payload);
    } catch (error) {
      this.onError(error, entry.batch);
    }
  }

  enqueue(payload: T): DeferredBatch<T> {
    this.counter += 1;
    const batch: DeferredBatch<T> = {
      token: `undo-${this.counter}`,
      payload,
      dueAt: this.timers.now() + this.delayMs,
    };
    const handle = this.timers.setTimeout(() => {
      void this.sendNow(batch.token);
    }, this.delayMs);
    this.entries.push({ batch, handle });
    return batch;
  }

  /**
   * Cancels one pending batch (by token) or the newest one (token null).
   * Returns null when there is nothing to undo, e.g. it was already sent.
   */
  undo(token: string | null): DeferredBatch<T> | null {
    const index = token === null ? this.entries.length - 1 : this.entries.findIndex((e) => e.batch.token === token);
    if (index < 0) {
      return null;
    }
    const [entry] = this.entries.splice(index, 1);
    if (!entry) {
      return null;
    }
    this.timers.clearTimeout(entry.handle);
    return entry.batch;
  }

  /** Oldest first. */
  pending(): DeferredBatch<T>[] {
    return this.entries.map((entry) => entry.batch);
  }

  /** Sends every pending batch now, oldest first. */
  async flush(): Promise<void> {
    const tokens = this.entries.map((entry) => entry.batch.token);
    for (const token of tokens) {
      await this.sendNow(token);
    }
  }
}
