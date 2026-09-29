import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResult } from '@postpile/core';
import { queryLengthBucket, searchTelemetryDue } from '../lib/telemetry.ts';
import { useDebounced } from '../lib/use-debounced.ts';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';
import { sendTelemetry } from './telemetry.ts';

/** Keystrokes closer together than this make one request. */
const DEBOUNCE_MS = 150;

// Module-level, not component state: search_used stays rare across re-renders and remounts too.
let lastSearchTelemetryMs = 0;

function reportSearchUsed(query: string): void {
  const now = Date.now();
  if (!searchTelemetryDue(lastSearchTelemetryMs, now)) {
    return;
  }
  lastSearchTelemetryMs = now;
  sendTelemetry('search_used', { query_length_bucket: queryLengthBucket(query.length) });
}

/**
 * Search bar filter: matching topics and tiles. Disabled for a blank query.
 * While the next answer loads, the previous one stays, so the screen does not
 * flash back to everything on each keystroke.
 */
export function useSearch(query: string) {
  const settled = useDebounced(query.trim(), DEBOUNCE_MS);
  return useQuery({
    queryKey: queryKeys.search(settled),
    queryFn: () => {
      reportSearchUsed(settled);
      return request<SearchResult>('GET', `/api/search?q=${encodeURIComponent(settled)}`);
    },
    enabled: settled !== '' && query.trim() !== '',
    placeholderData: keepPreviousData,
  });
}
