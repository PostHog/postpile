// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InboxCleanupView, InterruptionsMode, InterruptionsView } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { InterruptionsPrompt } from './InterruptionsPrompt.tsx';

const neverChosen: InterruptionsView = { mode: 'never', chosen: false, roundupTimes: ['9:30', '13:30', '16:30'] };

const noStartDialog: InboxCleanupView = {
  countedAt: '2026-10-05T09:00:00.000Z',
  counts: { unread: 0, mergedQuiet7: 0, mergedQuiet14: 0, mergedAll: 0, mergedWithoutReview: 0, mergedSafe: 0, olderThan14: 0, olderThan30: 0 },
  glances: 0,
  options: [],
  start: null,
  running: null,
  lastRun: null,
  pending: false,
  syncing: false,
};

interface PutCall {
  body: { mode: InterruptionsMode; from: string };
  answer: (ok: boolean) => void;
}

/** Every PUT /api/interruptions waits until the test answers it; any other request never answers. */
function stubFetch(): PutCall[] {
  const calls: PutCall[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.endsWith('/api/interruptions') || init?.method !== 'PUT') {
      return new Promise(() => {});
    }
    const body = JSON.parse(String(init.body)) as PutCall['body'];
    return new Promise((resolve) => {
      calls.push({
        body,
        answer: (ok) =>
          resolve({
            ok,
            statusText: ok ? 'OK' : 'Internal Server Error',
            json: async () => (ok ? { ...neverChosen, mode: body.mode, chosen: true } : { error: 'database is locked' }),
          }),
      });
    });
  });
  return calls;
}

function renderPrompt() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.interruptions, neverChosen);
  client.setQueryData(queryKeys.inboxCleanup, noStartDialog);
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <InterruptionsPrompt blocked={false} />
      </ActionsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InterruptionsPrompt', () => {
  it('stays open while saving and after a failed save, and closes once a save landed', async () => {
    const calls = stubFetch();
    renderPrompt();
    fireEvent.click(screen.getByText('As soon as it matters'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ mode: 'asap', from: 'prompt' });
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => calls[0]?.answer(false));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.body).toEqual({ mode: 'asap', from: 'prompt' });
    await act(async () => calls[1]?.answer(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves Never on Esc and stays open when that fails', async () => {
    const calls = stubFetch();
    renderPrompt();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ mode: 'never', from: 'prompt' });

    await act(async () => calls[0]?.answer(false));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
