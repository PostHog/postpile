import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResult } from '@postpile/core';
import { useDebounced } from '../lib/use-debounced.ts';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Keystrokes closer together than this make one request. */
const DEBOUNCE_MS = 150;

/**
 * Search bar filter: matching topics and tiles. Disabled for a blank query.
 * While the next answer loads, the previous one stays, so the screen does not
 * flash back to everything on each keystroke.
 */
export function useSearch(query: string) {
  const settled = useDebounced(query.trim(), DEBOUNCE_MS);
  return useQuery({
    queryKey: queryKeys.search(settled),
    queryFn: () => request<SearchResult>('GET', `/api/search?q=${encodeURIComponent(settled)}`),
    enabled: settled !== '' && query.trim() !== '',
    placeholderData: keepPreviousData,
  });
}
