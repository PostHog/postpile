import { describe, expect, it } from 'vitest';
import type { PrNotesView } from '@postpile/core';
import { contextNoteLines, notesJson, untilText } from './notes-text.ts';

describe('untilText', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  it('names the unit of every part', () => {
    expect(untilText(inMinutes(179.5), now)).toBe('2 h 59 min');
    expect(untilText(inMinutes(120), now)).toBe('2 h');
    expect(untilText(inMinutes(45), now)).toBe('45 min');
    expect(untilText(inMinutes(0.5), now)).toBe('under a minute');
  });
});

describe('contextNoteLines', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const view: PrNotesView = {
    prKey: 'acme/app#1902',
    token: 't',
    durable: null,
    lease: null,
    replaced: null,
    userCleared: { kind: 'no_action', client: 'claude-code', by: 'ph3 session', clearedAt: '2026-10-10T10:00:00Z' },
  };

  it('says when the user cleared a note, so another agent does not set it again', () => {
    expect(contextNoteLines(view, now)).toEqual(["The user cleared claude-code's no_action note (by ph3 session) 2 h ago: don't set it again unless they ask."]);
    expect(notesJson(view)).toMatchObject({ userCleared: { kind: 'no_action', clearedAt: '2026-10-10T10:00:00Z', untrusted: { client: 'claude-code', by: 'ph3 session' } } });
    expect(contextNoteLines({ ...view, userCleared: null }, now)).toEqual([]);
  });
});
