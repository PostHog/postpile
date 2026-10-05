// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BusyInboxView, InboxCleanupView } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { BUSY_CARD_FOLDED_KEY, BusyInboxCard } from './BusyInboxCard.tsx';

const busy: BusyInboxView = {
  busy: true,
  inboxPrs: 6140,
  keptPrs: 1500,
  quietPrs: 4640,
  cap: 1500,
  updatesLastHour: 300,
  writesLocked: true,
  keptYou: 940,
  keptTeam: 560,
  keptOthers: 0,
};

const somethingToClear: InboxCleanupView = {
  countedAt: '2026-10-05T09:00:00.000Z',
  counts: { unread: 210, mergedQuiet7: 31, mergedQuiet14: 0, mergedAll: 46, mergedWithoutReview: 9, mergedSafe: 8, olderThan14: 18, olderThan30: 6 },
  glances: 40,
  options: [],
  start: null,
  running: null,
  lastRun: null,
  pending: false,
  syncing: false,
};

/** The card with these numbers; every request stays unanswered, so only the seeded cache counts. */
function renderCard(view: BusyInboxView, onUnlockWrites: () => void = () => {}) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.busyInbox, view);
  client.setQueryData(queryKeys.inboxCleanup, somethingToClear);
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <BusyInboxCard onUnlockWrites={onUnlockWrites} />
      </ActionsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('BusyInboxCard', () => {
  it('renders nothing while the inbox is not busy', () => {
    renderCard({ ...busy, busy: false });
    expect(screen.queryByRole('region', { name: 'Busy inbox' })).toBeNull();
    expect(screen.queryByText(/quiet PR/)).toBeNull();
  });

  it('shows the quiet PRs and what is kept per tier', () => {
    renderCard(busy);
    const card = screen.getByRole('region', { name: 'Busy inbox' });
    expect(card.textContent).toContain('Focusing on what is aimed at you. 4,640 quiet PRs wait for news.');
    expect(card.textContent).toContain('940 for you');
    expect(card.textContent).toContain('560 for your team');
    expect(card.textContent).toContain('0 for others');
  });

  it('offers Unlock writes only while writes are locked, and hands the click to the footer lock', () => {
    const onUnlockWrites = vi.fn();
    renderCard(busy, onUnlockWrites);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock writes' }));
    expect(onUnlockWrites).toHaveBeenCalledOnce();
    cleanup();

    renderCard({ ...busy, writesLocked: false });
    expect(screen.getByRole('region', { name: 'Busy inbox' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlock writes' })).toBeNull();
  });

  it('opens Why? inline with what PostPile does now', () => {
    renderCard(busy);
    const why = screen.getByRole('button', { name: 'Why?' });
    expect(why.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Other people's PRs wait/)).toBeNull();
    fireEvent.click(why);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText("It keeps your PRs and what is aimed at you, then your team's.")).toBeTruthy();
    expect(screen.getByText(/Other people's PRs wait, with no fetching and no agent work/)).toBeTruthy();
    expect(screen.getByText('This goes away by itself once your inbox is back under 1,500.')).toBeTruthy();
  });

  it('opens the inbox cleanup dialog from Clean up', () => {
    renderCard(busy);
    fireEvent.click(screen.getByRole('button', { name: 'Clean up' }));
    expect(screen.getByRole('dialog', { name: 'Clean up your inbox' })).toBeTruthy();
  });

  it('folds to one line for the session and opens again', () => {
    renderCard(busy);
    fireEvent.click(screen.getByRole('button', { name: 'Fold the busy inbox card' }));
    expect(screen.queryByRole('region', { name: 'Busy inbox' })).toBeNull();
    expect(window.sessionStorage.getItem(BUSY_CARD_FOLDED_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Busy inbox · 4,640 quiet PRs' })).toBeTruthy();

    // A remount in the same session stays folded.
    cleanup();
    renderCard(busy);
    expect(screen.queryByRole('region', { name: 'Busy inbox' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Busy inbox · 4,640 quiet PRs/ }));
    expect(screen.getByRole('region', { name: 'Busy inbox' })).toBeTruthy();
    expect(window.sessionStorage.getItem(BUSY_CARD_FOLDED_KEY)).toBeNull();
  });
});
