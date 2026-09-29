// Pure helpers for the notification debug view, shared by the engine and FakeEngine.

import { DEBUG_EVENTS_PER_PR, DEBUG_PING_DECISIONS_PER_THREAD, type DebugEventLine } from './debug-views.ts';
import { prKey } from './keys.ts';
import { effectiveLoudness } from './loudness.ts';
import type { PingDecision } from './pings.ts';
import type { NotificationThread, PrEvent, PrKey, PrRef } from './types.ts';

/** The PR a thread is about, as a ref. Only PullRequest threads with a number map to one. */
export function threadPrRef(thread: NotificationThread): PrRef | null {
  if (thread.subjectType !== 'PullRequest' || thread.number === null) {
    return null;
  }
  return { repo: thread.repo, number: thread.number };
}

/** The PR a thread is about, as a key (see `threadPrRef`). */
export function threadPrKey(thread: NotificationThread): PrKey | null {
  const ref = threadPrRef(thread);
  return ref === null ? null : prKey(ref);
}

/** The newest few events of a PR, trimmed for the debug view. */
export function debugEventLines(events: PrEvent[]): DebugEventLine[] {
  return [...events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, DEBUG_EVENTS_PER_PR)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      actor: event.actor,
      at: event.at,
      summary: event.summary,
      loudness: effectiveLoudness(event),
      seen: event.seenAt !== null,
    }));
}

/** Ping decisions grouped by thread, newest first, at most DEBUG_PING_DECISIONS_PER_THREAD each. Takes them in any order. */
export function pingDecisionsByThread(decisions: PingDecision[]): Map<string, PingDecision[]> {
  const result = new Map<string, PingDecision[]>();
  const newestFirst = [...decisions].sort((a, b) => b.at.localeCompare(a.at));
  for (const decision of newestFirst) {
    const list = result.get(decision.threadId) ?? [];
    if (list.length < DEBUG_PING_DECISIONS_PER_THREAD) {
      list.push(decision);
    }
    result.set(decision.threadId, list);
  }
  return result;
}
