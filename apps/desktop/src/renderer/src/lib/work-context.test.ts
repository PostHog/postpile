import { describe, expect, it } from 'vitest';
import type { WorkContextInputStats, WorkContextView } from '@postpile/core';
import { inputLine, parseSkipText, skipNote, skipText, sourceLabel, sweepStatus } from './work-context.ts';

const stats: WorkContextInputStats = {
  budgetChars: 60000,
  sentChars: 41230,
  claudeMdFiles: 2,
  memoryFiles: 18,
  sessions: 26,
  sessionFilesScanned: 61,
  maskedSecrets: 1,
  droppedCount: 3,
  dropped: [],
};

function view(overrides: Partial<WorkContextView> = {}): WorkContextView {
  return {
    current: { version: 4, createdAt: '2026-09-28T07:00:00.000Z', model: 'opus', summary: 's', lastSeenAt: null, threads: [], inputStats: stats },
    lastError: null,
    running: false,
    skipPatterns: ['taxes'],
    ...overrides,
  };
}

const NOW = new Date('2026-09-28T10:00:00.000Z');

describe('work context labels', () => {
  it('names the source kind before its ref', () => {
    expect(sourceLabel({ kind: 'session', ref: 'app · 2026-09-27 10:01' })).toBe('Session · app · 2026-09-27 10:01');
    expect(sourceLabel({ kind: 'memory', ref: '~/.claude/projects/p/memory/a.md' })).toBe('Memory file · ~/.claude/projects/p/memory/a.md');
  });

  it('sums up the input', () => {
    expect(inputLine(stats)).toBe('Read 41k of 60k chars: 2 CLAUDE.md, 18 memory files, 26 sessions; 3 left out');
    expect(inputLine({ ...stats, skippedProjects: 2 })).toMatch(/; 2 private projects skipped$/);
  });

  it('edits the skip list as comma separated text', () => {
    expect(skipText(['taxes', 'garden'])).toBe('taxes, garden');
    expect(parseSkipText(' taxes ,, side-project ,')).toEqual(['taxes', 'side-project']);
    expect(parseSkipText('')).toEqual([]);
  });

  it('says where the skip list comes from', () => {
    const file = '~/.config/postpile/config.json';
    expect(skipNote({ skipPatterns: [], skipSource: 'config', skipConfigFile: file })).toBe(`Empty: every project folder is read. Saved in ${file}.`);
    expect(skipNote({ skipPatterns: ['a'], skipSource: 'default', skipConfigFile: file })).toMatch(/These are the defaults; saving writes your own list\.$/);
    expect(skipNote({ skipPatterns: ['a'], skipSource: 'env', skipConfigFile: file })).toMatch(/Set by POSTPILE_SWEEP_SKIP, which wins/);
  });

  it('says when it was written, that it runs, or that the last refresh failed', () => {
    expect(sweepStatus(view(), NOW)).toBe('Updated 3h ago (v4).');
    expect(sweepStatus(view({ running: true }), NOW)).toMatch(/^Reading your notes/);
    expect(sweepStatus(view({ lastError: { message: 'boom', at: NOW.toISOString() } }), NOW)).toBe(
      'Updated 3h ago (v4). The last refresh failed, so this is the previous version.',
    );
    expect(sweepStatus(view({ current: null }), NOW)).toBe('Not written yet.');
  });
});
