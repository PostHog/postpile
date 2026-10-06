// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitHubWritesStatus } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { SnoozeMenu } from './SnoozeMenu.tsx';

const LOCKED: GitHubWritesStatus = { enabled: false, forcedOffReason: null, pending: [] };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Records every snooze request and answers it; any other request (the refetches after an action) never answers. */
function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.includes('/snooze')) {
      return new Promise(() => {});
    }
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve({ ok: true, statusText: 'OK', json: async () => ({ ok: true, message: 'Muted', undoToken: null }) });
  });
  return calls;
}

/** `writesKnown` false: the app has not heard yet whether GitHub writes are on, so every GitHub write is blocked. */
function renderMenu(props: { snoozed: boolean; muted: boolean; partlyMuted?: boolean; unmuteRest?: boolean; writesKnown?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  // Locked on purpose: a mute is guarded like a mark-read, so it still runs and waits as a pending write.
  if (props.writesKnown !== false) {
    client.setQueryData(queryKeys.githubWrites, LOCKED);
  }
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <SnoozeMenu tileId="pr:acme/app#1" snoozed={props.snoozed} muted={props.muted} partlyMuted={props.partlyMuted} unmuteRest={props.unmuteRest} />
      </ActionsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SnoozeMenu', () => {
  it('mutes from the last item, also while GitHub writes are locked', async () => {
    const calls = stubFetch();
    renderMenu({ snoozed: false, muted: false });

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    const mute = screen.getByRole('menuitem', { name: "Mute until I'm mentioned" });
    expect(mute.getAttribute('title')).toMatch(/requests your review.*pending write/s);
    fireEvent.click(mute);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'POST', body: { condition: { kind: 'muted' } } });
    expect(calls[0]?.url).toContain(`/api/tiles/${encodeURIComponent('pr:acme/app#1')}/snooze`);
  });

  it('offers Unmute on a muted tile and Unsnooze on a snoozed one, both taking the snooze back', async () => {
    const calls = stubFetch();
    renderMenu({ snoozed: true, muted: true });
    expect(screen.queryByRole('button', { name: 'Unsnooze' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.method).toBe('DELETE');
    cleanup();
    renderMenu({ snoozed: true, muted: false });
    expect(screen.getByRole('button', { name: 'Unsnooze' })).toBeTruthy();
  });

  it('guards Unsnooze as a GitHub write when some PRs of the snoozed tile are muted', async () => {
    const calls = stubFetch();
    renderMenu({ snoozed: true, muted: false, partlyMuted: true, writesKnown: false });
    const unsnooze = screen.getByRole('button', { name: 'Unsnooze' });
    expect(unsnooze.getAttribute('title')).toMatch(/blocked until the app knows/);

    fireEvent.click(unsnooze);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);
    cleanup();

    // A plain snooze is local only: no guard, it goes through before the writes state is known.
    renderMenu({ snoozed: true, muted: false, writesKnown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Unsnooze' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.method).toBe('DELETE');
  });

  it('adds "Unmute the rest" only when core offers it, and it takes the remaining mutes back', async () => {
    const calls = stubFetch();
    renderMenu({ snoozed: false, muted: false });
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    expect(screen.queryByRole('menuitem', { name: 'Unmute the rest' })).toBeNull();
    cleanup();

    renderMenu({ snoozed: false, muted: false, unmuteRest: true });
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unmute the rest' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.method).toBe('DELETE');
  });
});
