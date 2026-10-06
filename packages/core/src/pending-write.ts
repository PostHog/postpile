// A pending write's lifecycle as one transition function (DESIGN.md "Rules
// layer: one home per fact"): (write, cause) -> (next, effects). A pending
// write is a mark-read (or the inbox cleanup) made while GitHub writes were
// locked. It waits until the user sends it, discards it, or GitHub shows the
// thread read elsewhere. The engine carries out the effects and stores the
// next state; this module only decides.
import type { PendingThread, PendingWrite } from './github-writes.ts';
import type { PrKey } from './types.ts';

/** What one thread's send came to. off: the lock closed while the write was on its way, nothing was sent. */
export type ThreadOutcome =
  | { kind: 'sent' }
  | { kind: 'observed' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'off' };

/** What happened to a pending write. */
export type PendingWriteCause =
  /** The user sent a mark_read (or a subscription change): one outcome per thread, in the write's thread order. */
  | { kind: 'sent'; outcomes: ThreadOutcome[] }
  /** GitHub took the old cleanup's single PUT, or a catch-up's run started in the background. */
  | { kind: 'cleanup_sent' }
  /** The cleanup's PUT failed, or the lock closed mid-send (or before a catch-up could start). */
  | { kind: 'cleanup_not_taken'; error: string }
  /** The sync or the poll saw these threads leave the inbox (read on github.com or another client). */
  | { kind: 'read_elsewhere'; threadIds: ReadonlySet<string> }
  /** The user discarded it. */
  | { kind: 'discarded' };

/** Where the write stands afterwards. */
export type PendingWriteNext =
  /** Done: the row goes. */
  | { kind: 'gone' }
  /** A try left these threads (or the cleanup) unsent: they stay, with the error. */
  | { kind: 'kept'; threads: PendingThread[]; error: string }
  /** Some threads were read elsewhere: the rest stay, the error untouched. */
  | { kind: 'narrowed'; threads: PendingThread[] }
  | { kind: 'unchanged' };

/** What the engine carries out, in order. */
export type PendingWriteEffect =
  /** These PRs turn read here: what the user saw at the click seen, the write's handle keys among them handled. */
  | { kind: 'read_here'; prKeys: PrKey[] }
  /** A PR without an unread thread followed the rest; logged as a `local` mark-read. */
  | { kind: 'log_local'; prKey: PrKey }
  /** GitHub left a thread unread on purpose (activity after the last sync); said in the send result. */
  | { kind: 'not_taken'; reason: string }
  /** The try failed and the write stays pending; said in the send result. */
  | { kind: 'still_pending'; error: string }
  /** Every thread (or the cleanup) logged as discarded. */
  | { kind: 'log_discarded' }
  /** A discarded Unmute: these PRs are muted again, as of the Unmute's click, unless they have a snooze by now. */
  | { kind: 'mute_again'; prKeys: PrKey[] };

export interface PendingWriteStep {
  next: PendingWriteNext;
  effects: PendingWriteEffect[];
}

/** Why a pending write the lock stopped mid-send stays pending. */
export const PENDING_WRITES_OFF = 'GitHub writes are off';

const NO_STEP: PendingWriteStep = { next: { kind: 'unchanged' }, effects: [] };

/**
 * Every thread of the write is through: PRs without an unread thread had
 * nothing to send and follow the rest, then the row goes.
 */
function finished(write: PendingWrite, effects: PendingWriteEffect[]): PendingWriteStep {
  const threadKeys = new Set(write.threads.map((thread) => thread.prKey));
  const quiet = write.prKeys.filter((key) => !threadKeys.has(key));
  const followers: PendingWriteEffect[] = quiet.map((prKey) => ({ kind: 'log_local', prKey }));
  const readQuiet: PendingWriteEffect[] = quiet.length > 0 ? [{ kind: 'read_here', prKeys: quiet }] : [];
  return { next: { kind: 'gone' }, effects: [...effects, ...readQuiet, ...followers] };
}

/**
 * A mark_read after a send. Threads GitHub took or already had read turn
 * read here; skipped ones stay unread on purpose and do not keep the write;
 * failed ones and ones the lock stopped stay pending with the first error.
 */
function afterSend(write: PendingWrite, outcomes: ThreadOutcome[]): PendingWriteStep {
  const left: PendingThread[] = [];
  const errors: string[] = [];
  const effects: PendingWriteEffect[] = [];
  write.threads.forEach((thread, index) => {
    const outcome = outcomes[index];
    if (outcome?.kind === 'failed') {
      left.push(thread);
      errors.push(outcome.error);
    } else if (outcome?.kind === 'off') {
      left.push(thread);
      errors.push(PENDING_WRITES_OFF);
    } else if (outcome?.kind === 'skipped') {
      effects.push({ kind: 'not_taken', reason: outcome.reason });
    } else if (outcome && thread.prKey !== null) {
      effects.push({ kind: 'read_here', prKeys: [thread.prKey] });
    }
  });
  if (left.length > 0) {
    const error = errors[0] ?? 'failed';
    return { next: { kind: 'kept', threads: left, error }, effects: [...effects, { kind: 'still_pending', error }] };
  }
  return finished(write, effects);
}

/** Threads read elsewhere have nothing left to send: their PRs turn read here, like a send that found them read. */
function afterReadElsewhere(write: PendingWrite, threadIds: ReadonlySet<string>): PendingWriteStep {
  const observed = write.threads.filter((thread) => threadIds.has(thread.id));
  if (observed.length === 0) {
    return NO_STEP;
  }
  const effects: PendingWriteEffect[] = observed.flatMap((thread) => (thread.prKey === null ? [] : [{ kind: 'read_here' as const, prKeys: [thread.prKey] }]));
  const left = write.threads.filter((thread) => !threadIds.has(thread.id));
  if (left.length > 0) {
    return { next: { kind: 'narrowed', threads: left }, effects };
  }
  return finished(write, effects);
}

/**
 * A Mute's or Unmute's subscription change after a send: threads GitHub
 * took are through; failed ones and ones the lock stopped stay pending with
 * the first error. Nothing turns read here: the click's mark_read row does
 * that.
 */
function afterSubscriptionSend(write: PendingWrite, outcomes: ThreadOutcome[]): PendingWriteStep {
  const left: PendingThread[] = [];
  const errors: string[] = [];
  write.threads.forEach((thread, index) => {
    const outcome = outcomes[index];
    if (outcome?.kind === 'failed') {
      left.push(thread);
      errors.push(outcome.error);
    } else if (outcome?.kind === 'off') {
      left.push(thread);
      errors.push(PENDING_WRITES_OFF);
    }
  });
  if (left.length > 0) {
    const error = errors[0] ?? 'failed';
    return { next: { kind: 'kept', threads: left, error }, effects: [{ kind: 'still_pending', error }] };
  }
  return { next: { kind: 'gone' }, effects: [] };
}

/**
 * Discarded: the row goes and its threads are logged. A discarded Unmute
 * also puts its mute back (2026-10-06): the Unmute took the mute away at
 * the click, and GitHub still has the viewer unsubscribed, so without the
 * mute the tile would offer no Unmute and stay quiet for good.
 */
function afterDiscard(write: PendingWrite): PendingWriteStep {
  const effects: PendingWriteEffect[] = [{ kind: 'log_discarded' }];
  if (write.kind === 'subscribe') {
    const prKeys = [...new Set(write.threads.flatMap((thread) => (thread.prKey === null ? [] : [thread.prKey])))];
    effects.push({ kind: 'mute_again', prKeys });
  }
  return { next: { kind: 'gone' }, effects };
}

/** The old cleanup's PUT and the catch-up: no thread list to send, one write as a whole. */
function isCleanup(write: PendingWrite): boolean {
  return write.kind === 'mark_all_read_before' || write.kind === 'catch_up';
}

/** A Mute's or Unmute's change to the GitHub subscription (`SubscriptionChange`). */
export function isSubscriptionWrite(write: Pick<PendingWrite, 'kind'>): boolean {
  return write.kind === 'unsubscribe' || write.kind === 'subscribe';
}

/**
 * The one place a pending write changes. A cleanup only knows sent, not
 * taken (it stays pending, also when the lock closes during Send) and
 * discarded; a read elsewhere never clears it, nor a subscription change
 * (reading a thread on github.com does not mute it).
 */
export function pendingWriteStep(write: PendingWrite, cause: PendingWriteCause): PendingWriteStep {
  switch (cause.kind) {
    case 'discarded':
      return afterDiscard(write);
    case 'cleanup_sent':
      return isCleanup(write) ? { next: { kind: 'gone' }, effects: [] } : NO_STEP;
    case 'cleanup_not_taken':
      if (!isCleanup(write)) {
        return NO_STEP;
      }
      return { next: { kind: 'kept', threads: [], error: cause.error }, effects: [{ kind: 'still_pending', error: cause.error }] };
    case 'sent':
      if (isSubscriptionWrite(write)) {
        return afterSubscriptionSend(write, cause.outcomes);
      }
      return write.kind === 'mark_read' ? afterSend(write, cause.outcomes) : NO_STEP;
    case 'read_elsewhere':
      return write.kind === 'mark_read' ? afterReadElsewhere(write, cause.threadIds) : NO_STEP;
    default: {
      const never: never = cause;
      return never;
    }
  }
}
