import { describe, expect, it } from 'vitest';
import { formatSweep } from './format-work-context.ts';

describe('formatSweep', () => {
  it('prints stats, drops, the summary and threads with topics and sources', () => {
    const stats = {
      budgetChars: 60000,
      sentChars: 1200,
      claudeMdFiles: 1,
      memoryFiles: 2,
      sessions: 3,
      sessionFilesScanned: 5,
      maskedSecrets: 0,
      droppedCount: 2,
      dropped: [{ kind: 'session' as const, ref: 'lsp · 2026-09-21 16:46', reason: 'started by a program (SDK)' }],
      skippedProjects: 2,
      skipPatterns: ['taxes', 'hobby'],
    };
    const text = formatSweep(
      { ok: true, message: 'Work context v2: 1 threads from 1200 chars', version: 2, stats },
      {
        current: {
          version: 2,
          createdAt: '2026-09-28T07:00:00.000Z',
          model: 'opus',
          summary: 'Alice drives the Depot move.',
          lastSeenAt: null,
          inputStats: stats,
          threads: [
            {
              index: 0,
              title: 'Depot rollout',
              detail: 'Runners to posthog.',
              topics: [{ id: 'depot', name: 'Move CI to Depot' }],
              sources: [{ kind: 'memory', ref: '~/.claude/projects/p/memory/depot.md' }],
              forgotten: false,
            },
          ],
        },
        lastError: null,
        running: false,
        skipPatterns: ['taxes', 'hobby'],
      },
    );
    expect(text).toBe(
      [
        'Work context v2: 1 threads from 1200 chars',
        'input 1200 of 60000 chars: 1 CLAUDE.md, 2 memory files, 3 sessions (of 5 session files), 0 secrets masked',
        'skipped 2 project folders (skip list: taxes, hobby)',
        'dropped 2:',
        '  session lsp · 2026-09-21 16:46: started by a program (SDK)',
        '  ... and 1 more',
        '',
        "What you're working on (v2, 2026-09-28T07:00:00.000Z, opus)",
        '',
        'Alice drives the Depot move.',
        '',
        '- Depot rollout: Runners to posthog.',
        '    topics: Move CI to Depot',
        '    why: memory ~/.claude/projects/p/memory/depot.md',
      ].join('\n'),
    );
  });
});
