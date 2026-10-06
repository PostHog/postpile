// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitHubWritesStatus, PrKey, TileView } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { dotCountdown, OPENED_READ_DELAY_MS } from './opened-read.ts';
import { useOpenedRead } from './use-opened-read.ts';

const ON: GitHubWritesStatus = { enabled: true, forcedOffReason: null, pending: [] };
const A: PrKey = 'acme/app#1';
const B: PrKey = 'acme/app#2';

/** Only what `useOpenedRead` reads of a tile: both PRs may be marked when opened. */
const VIEW = {
  prs: [
    { key: A, openedRead: { kind: 'mark' } },
    { key: B, openedRead: { kind: 'mark' } },
  ],
  offers: { pane: {} },
} as unknown as TileView;

/** The opened mark answers marked with an undo token; every other request (refetches) never answers. */
function stubFetch() {
  vi.stubGlobal('fetch', (url: string) => {
    if (!url.endsWith('/opened')) {
      return new Promise(() => {});
    }
    const until = new Date(Date.now() + 60_000).toISOString();
    return Promise.resolve({ ok: true, statusText: 'OK', json: async () => ({ marked: true, undoToken: 'undo-1', undoUntil: until }) });
  });
}

function wrapper(props: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.githubWrites, ON);
  return (
    <QueryClientProvider client={client}>
      <ActionsProvider>{props.children}</ActionsProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useOpenedRead', () => {
  it('starts the next PR full and drains it, after the previous one was marked', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    stubFetch();
    const seen: { prKey: PrKey; countdown: ReturnType<typeof dotCountdown> }[] = [];
    const { result, rerender } = renderHook(
      (props: { prKey: PrKey }) => {
        const opened = useOpenedRead(VIEW, props.prKey);
        seen.push({ prKey: props.prKey, countdown: dotCountdown(opened, props.prKey) });
        return opened;
      },
      { wrapper, initialProps: { prKey: A } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS);
    });
    expect(result.current.marked).not.toBeNull();
    expect(dotCountdown(result.current, A)).toBe('drained');

    seen.length = 0;
    rerender({ prKey: B });
    // The first render of B has no phase of its own yet: full, never the empty pie A ended with.
    expect(seen[0]).toEqual({ prKey: B, countdown: null });
    expect(seen.some((entry) => entry.countdown === 'drained')).toBe(false);
    expect(dotCountdown(result.current, B)).toBe('draining');
  });
});
