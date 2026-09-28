// Pure helpers for the notification debug view, shared by the engine and FakeEngine.

import { DEBUG_EVENTS_PER_PR, type DebugEventLine } from './debug-views.ts';
import { prKey } from './keys.ts';
import type { NotificationThread, PrEvent, PrKey } from './types.ts';

/** The PR a thread is about. Only PullRequest threads with a number map to one. */
export function threadPrKey(thread: NotificationThread): PrKey | null {
  if (thread.subjectType !== 'PullRequest' || thread.number === null) {
    return null;
  }
  return prKey({ repo: thread.repo, number: thread.number });
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
      loudness: event.override?.loudness ?? event.ruleLoudness,
      seen: event.seenAt !== null,
    }));
}
