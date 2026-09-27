/**
 * Caps how many tasks run at once. A sync can ask for dozens of glances; each
 * one is a `claude` process, and starting them all together makes every one
 * of them slow and can trip rate limits.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`concurrency limit must be a positive integer, got ${max}`);
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // The slot passes straight to the next task; running stays the same.
      next();
      return;
    }
    this.running -= 1;
  }
}
