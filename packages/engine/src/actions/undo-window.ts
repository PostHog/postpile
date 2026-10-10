import { randomBytes } from 'node:crypto';
import { UNDO_WINDOW_MS, type ActionResult } from '@postpile/core';
import { failed, ok } from './results.ts';

interface Entry {
  until: number;
  undo: () => void;
}

/**
 * Local choices that can be taken back for UNDO_WINDOW_MS, like a memory
 * correction: a Decline in the Inbox, a removed rule or tailoring line.
 * Tokens carry the owner's prefix so Engine.undo knows where to send them.
 * Kept in memory, like the mark-read queue: a restart closes every window.
 */
export class UndoWindow {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly prefix: string,
    private readonly now: () => Date,
  ) {}

  /** Remembers how to take a choice back and returns its token. */
  add(undo: () => void): string {
    const nowMs = this.now().getTime();
    for (const [token, entry] of this.entries) {
      if (entry.until <= nowMs) {
        this.entries.delete(token);
      }
    }
    const token = `${this.prefix}${randomBytes(6).toString('hex')}`;
    this.entries.set(token, { until: nowMs + UNDO_WINDOW_MS, undo });
    return token;
  }

  owns(token: string | null): boolean {
    return token !== null && token.startsWith(this.prefix);
  }

  undo(token: string): ActionResult {
    const entry = this.entries.get(token);
    this.entries.delete(token);
    if (!entry || entry.until <= this.now().getTime()) {
      return failed('undo window closed');
    }
    entry.undo();
    return ok('Undone');
  }
}
