import type { TelemetryEventProps } from '@postpile/core';

/** search_used's query_length_bucket: never the query itself, just a size class. */
export function queryLengthBucket(length: number): TelemetryEventProps<'search_used'>['query_length_bucket'] {
  if (length <= 3) {
    return 'short';
  }
  return length <= 10 ? 'medium' : 'long';
}

/** A search fires on every debounced keystroke (api/search.ts); this keeps the event itself rarer. */
export const SEARCH_TELEMETRY_THROTTLE_MS = 10_000;

/** Whether enough time passed since `lastSentMs` to send another search_used. Pure: api/search.ts owns the clock and the send. */
export function searchTelemetryDue(lastSentMs: number, now: number): boolean {
  return now - lastSentMs >= SEARCH_TELEMETRY_THROTTLE_MS;
}
