// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitHubWritesStatus, PendingWriteView } from '@postpile/core';
import { ActionsProvider } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { WritesLock } from './WritesLock.tsx';

const on: GitHubWritesStatus = { enabled: true, forcedOffReason: null, pending: [] };
const locked: GitHubWritesStatus = { enabled: false, forcedOffReason: null, pending: [] };

const pendingWrite: PendingWriteView = {
  id: 1,
  kind: 'mark_read',
  createdAt: '2026-10-01T09:00:00.000Z',
  origin: 'tile',
  title: 'Move CI to Depot',
  prKeys: ['acme/app#1'],
  tileId: 'pr:acme/app#1',
  threadCount: 1,
  error: null,
};

/** The lock over a seeded writes state; every request stays unanswered, so only the cache counts. */
function renderLock(writes: GitHubWritesStatus) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.githubWrites, writes);
  render(
    <QueryClientProvider client={client}>
      <ActionsProvider>
        <WritesLock />
      </ActionsProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole('button');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WritesLock', () => {
  it('shows only a faint icon while writes are on', () => {
    const lock = renderLock(on);
    expect(lock.getAttribute('aria-label')).toBe('GitHub writes on, click to lock');
    expect(lock.textContent).toBe('');
    expect(lock.className).toContain('text-faint');
  });

  it('adds the count while mark-reads from the locked days wait, and lists them on a click', () => {
    const lock = renderLock({ ...on, pending: [pendingWrite] });
    expect(lock.textContent).toBe('1');
    fireEvent.click(lock);
    const popover = screen.getByRole('dialog', { name: 'Pending GitHub writes' });
    expect(popover.textContent).toContain('Move CI to Depot');
    expect(screen.getByRole('button', { name: 'Send 1 to GitHub' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeTruthy();
  });

  it('says read-only in the footer text colour while locked, never an alarm colour', () => {
    const lock = renderLock(locked);
    expect(lock.textContent).toBe('read-only');
    expect(lock.className).not.toMatch(/amber|status-bad|unread|honey/);
    fireEvent.click(lock);
    expect(screen.getByRole('dialog', { name: 'Allow GitHub writes' }).textContent).toContain('Mark-read and approvals will reach GitHub.');
  });

  it('cannot unlock under POSTPILE_READ_ONLY=1 and says why', () => {
    const lock = renderLock({ ...locked, forcedOffReason: 'POSTPILE_READ_ONLY=1 forces read-only.' });
    expect(lock.textContent).toBe('read-only');
    expect(lock.hasAttribute('disabled')).toBe(true);
    expect(lock.getAttribute('title')).toContain('POSTPILE_READ_ONLY=1 forces read-only.');
  });
});
