import { describe, expect, it } from 'vitest';
import type { InboxCleanupView } from '@postpile/core';
import { backlogText, cleanupChoices } from './cleanup.ts';

const view: InboxCleanupView = {
  unreadOlderThan14: 12,
  unreadOlderThan30: 4,
  look: 'line',
  hiddenUntil: null,
  pendingCutoff: null,
};

describe('inbox cleanup texts', () => {
  it('counts the backlog and the choices', () => {
    expect(backlogText(view)).toBe('12 unread older than 14 days');
    expect(cleanupChoices(view)).toEqual([
      { age: 14, count: 12 },
      { age: 30, count: 4 },
    ]);
  });
});
