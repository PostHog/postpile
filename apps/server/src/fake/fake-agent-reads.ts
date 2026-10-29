import { type AgentMarkReadResult, type AgentReadNotice } from '@postpile/core';

/**
 * The toast notice of an agent's mark_read over sample data, like the
 * engine's AgentMarkRead: the newest one, with an id that grows. The fake
 * engine does the marking itself.
 */
export class FakeAgentReads {
  private count = 0;
  private latest: AgentReadNotice | null = null;

  notice(): AgentReadNotice | null {
    return this.latest;
  }

  /** Grows with every call that marked something, so the renderer refetches. */
  changes(): number {
    return this.count;
  }

  marked(client: string, result: AgentMarkReadResult, undoToken: string): void {
    this.count += 1;
    this.latest = { id: this.count, client, prKeys: result.marked, writesLocked: result.writesLocked, undoToken, undoUntil: result.undoUntil ?? '' };
  }
}
