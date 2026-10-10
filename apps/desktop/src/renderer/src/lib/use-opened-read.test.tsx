// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitHubWritesStatus, PrKey, TileView } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { holdMenuOpen } from './open-menus.ts';
import { dotCountdown, OPENED_READ_DELAY_MS } from './opened-read.ts';
import { useOpenedRead } from './use-opened-read.ts';

const ON: GitHubWritesStatus = { enabled: true, forcedOffReason: null, pending: [] };
const LOCKED: GitHubWritesStatus = { enabled: false, forcedOffReason: null, pending: [] };
const A: PrKey = 'acme/app#1';
const B: PrKey = 'acme/app#2';

/** Only what `useOpenedRead` reads of a tile: both PRs may be marked when opened. */
const VIEW = {
  prs: [
    { key: A, openedRead: { kind: 'mark' } },
    { key: B, openedRead: { kind: 'mark' } },
  ],
  offers: { pane: {} },
  unreadPrKeys: [],
} as unknown as TileView;

/** The opened mark answers marked with an undo token; every other request (refetches) never answers. Returns how many marks were asked. */
function stubFetch(): () => number {
  let marks = 0;
  vi.stubGlobal('fetch', (url: string) => {
    if (!url.endsWith('/opened')) {
      return new Promise(() => {});
    }
    marks += 1;
    const until = new Date(Date.now() + 60_000).toISOString();
    return Promise.resolve({ ok: true, statusText: 'OK', json: async () => ({ marked: true, undoToken: 'undo-1', undoUntil: until }) });
  });
  return () => marks;
}

/** A wrapper whose writes state the test can change, starting at `writes`. */
function wrapperWith(writes: GitHubWritesStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.githubWrites, writes);
  const Wrapper = (props: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ActionsProvider>{props.children}</ActionsProvider>
    </QueryClientProvider>
  );
  return { client, Wrapper };
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

  it('marks nothing when writes unlock after the dwell ended while locked (BOARD-A-01)', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const marks = stubFetch();
    const { client, Wrapper } = wrapperWith(LOCKED);
    const { result } = renderHook(() => useOpenedRead(VIEW, A), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS);
    });
    // Unlock, or Discard in the lock popover, which unlocks too.
    await act(async () => {
      client.setQueryData(queryKeys.githubWrites, ON);
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS * 2);
    });
    expect(marks()).toBe(0);
    expect(result.current.marked).toBeNull();
  });

  it('holds the dwell while a menu is open and starts it over once it closes (BOARD-A-06)', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const marks = stubFetch();
    const { result } = renderHook(() => useOpenedRead(VIEW, A), { wrapper });

    let release = () => {};
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      release = holdMenuOpen();
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS * 2);
    });
    expect(marks()).toBe(0);

    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS - 1);
    });
    expect(marks()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(marks()).toBe(1);
    expect(result.current.marked).not.toBeNull();
  });

  it('runs no dwell without a PR: an app-picked tile is passed as null', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const marks = stubFetch();
    renderHook(() => useOpenedRead(VIEW, null), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPENED_READ_DELAY_MS * 2);
    });
    expect(marks()).toBe(0);
  });
});
