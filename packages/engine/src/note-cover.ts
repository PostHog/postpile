import { quotaPercent, type PrKey } from '@postpile/core';
import { errorText } from './errors.ts';
import type { GitHubQuota } from './github-quota.ts';

/** Covering PRs read for agent notes per hour. One per note is the normal case; a loop of bad numbers stops here. */
export const COVER_READS_PER_HOUR = 20;
/** How long a note waits for its covering PR. The MCP side gives up at AGENT_REQUEST_WAIT_MS (20 s), so this stays well under it. */
export const COVER_READ_WAIT_MS = 12_000;

const HOUR_MS = 3600_000;

/**
 * stored: the covering PR is stored now; not_found: GitHub has no such PR
 * the token can see; pending: still reading, it lands in the background;
 * blocked: nothing was read, see reason.
 */
export type CoverRead = { kind: 'stored' } | { kind: 'not_found' } | { kind: 'pending' } | { kind: 'blocked'; reason: string };

export interface NoteCoverDeps {
  now: () => Date;
  quota: GitHubQuota;
  /** Why PostPile reads nothing from GitHub right now (setup open, gh off), or null. */
  pausedReason: () => string | null;
  /** Reads the covering PR from GitHub and stores it (`GitHubSync.pullInCover`). */
  read: (cover: PrKey, notedKey: PrKey) => Promise<'stored' | 'not_found'>;
  /** Defaults to COVER_READ_WAIT_MS. */
  waitMs?: number;
}

/**
 * Reads the covering PR of a note_pr kind covered when PostPile does not
 * store it (DESIGN.md "Agent notes on PRs"). Every MCP session shares the
 * user's one GitHub quota, so the limits live here: nothing while the
 * quota is critical or reads are paused, at most COVER_READS_PER_HOUR
 * reads an hour, one read per PR at a time (a retry joins the running
 * one). A read slower than the wait is answered as pending and finishes
 * in the background, so calling again finds the PR stored.
 */
export class NoteCoverReader {
  /** When each read started, for the hourly cap. */
  private readonly readTimes: number[] = [];
  private readonly running = new Map<PrKey, Promise<CoverRead>>();

  constructor(private readonly deps: NoteCoverDeps) {}

  /** Why no read may start now; null when one may. */
  private refusal(): string | null {
    const paused = this.deps.pausedReason();
    if (paused !== null) {
      return `PostPile's GitHub reads are paused: ${paused}.`;
    }
    const state = this.deps.quota.state();
    if (state.level === 'critical') {
      const worst = state.worst;
      const left = worst ? ` (${worst.resource} ${quotaPercent(worst.remaining, worst.limit)}% left)` : '';
      const resumeAt = state.pollResumeAtMs === null ? '' : ` until it resets at ${new Date(state.pollResumeAtMs).toISOString()}`;
      return `The user's GitHub quota is nearly used${left}; PostPile reads nothing more${resumeAt}.`;
    }
    const now = this.deps.now().getTime();
    while (this.readTimes.length > 0 && (this.readTimes[0] ?? 0) <= now - HOUR_MS) {
      this.readTimes.shift();
    }
    if (this.readTimes.length >= COVER_READS_PER_HOUR) {
      const retryAt = new Date((this.readTimes[0] ?? now) + HOUR_MS).toISOString();
      return `Agents had ${COVER_READS_PER_HOUR} covering PRs read in the last hour; the next one is possible at ${retryAt}.`;
    }
    return null;
  }

  private start(cover: PrKey, notedKey: PrKey): Promise<CoverRead> {
    this.readTimes.push(this.deps.now().getTime());
    const run = this.deps
      .read(cover, notedKey)
      .then((outcome): CoverRead => ({ kind: outcome }))
      .catch((error: unknown): CoverRead => ({ kind: 'blocked', reason: `Reading ${cover} from GitHub failed: ${errorText(error)}.` }))
      .finally(() => this.running.delete(cover));
    this.running.set(cover, run);
    return run;
  }

  async read(cover: PrKey, notedKey: PrKey): Promise<CoverRead> {
    let run = this.running.get(cover);
    if (!run) {
      const refusal = this.refusal();
      if (refusal !== null) {
        return { kind: 'blocked', reason: refusal };
      }
      run = this.start(cover, notedKey);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<CoverRead>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'pending' }), this.deps.waitMs ?? COVER_READ_WAIT_MS);
    });
    try {
      return await Promise.race([run, waited]);
    } finally {
      clearTimeout(timer);
    }
  }
}
