import type { ActivityEvent, ActivityLine, ActivityList } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { shownActivity, unreadTextLeftOut, unreadTextLines } from './reads.ts';

function line(id: string, unread: boolean): ActivityLine {
  return { id, isNew: unread, unseen: unread } as unknown as ActivityLine;
}

function list(fresh: ActivityLine[], earlier: ActivityLine[]): ActivityList {
  return { fresh, earlier, noise: [], noiseLabel: '', freshNoise: [], freshNoiseLabel: '', cap: 12, threadChangedAt: null };
}

describe('shownActivity', () => {
  it('lists every unread line past the cap, so seen_through never covers a line the answer left out', () => {
    const fresh = Array.from({ length: 15 }, (_, index) => line(`new${index}`, true));
    const earlier = Array.from({ length: 5 }, (_, index) => line(`old${index}`, false));

    const shown = shownActivity(list(fresh, earlier));

    expect(shown.map((entry) => entry.id)).toEqual(fresh.map((entry) => entry.id));
  });

  it('fills the rest of the cap with read history, newest first', () => {
    const fresh = [line('new0', true)];
    const earlier = [line('quiet', true), ...Array.from({ length: 20 }, (_, index) => line(`old${index}`, false))];

    const shown = shownActivity(list(fresh, earlier)).map((entry) => entry.id);

    expect(shown).toHaveLength(12);
    expect(shown.slice(0, 3)).toEqual(['new0', 'quiet', 'old0']);
    expect(shown.at(-1)).toBe('old9');
  });
});

describe('unreadTextLines', () => {
  it("prints an unread comment's whole body, every row, uncut", () => {
    const body = `${'x'.repeat(400)}\nsecond paragraph`;
    const comment = { ...line('c1', true), body, fold: null, folded: [] } as unknown as ActivityLine;
    expect(unreadTextLines(comment)).toEqual([`      ${'x'.repeat(400)}`, '      second paragraph']);
  });

  it("prints every reply a bot-thread line folds, with who wrote it", () => {
    const thread = { ...line('t1', true), body: null, fold: 'bot_thread', folded: [{ id: 'r1', actor: 'alice', at: '2026-10-29T10:00:00Z', body: 'fixed in the next push', path: null }] } as unknown as ActivityLine;
    expect(unreadTextLines(thread)).toEqual(['      alice: fixed in the next push']);
  });
});

describe('unreadTextLeftOut', () => {
  function event(overrides: Partial<ActivityEvent>): ActivityEvent {
    return { id: 'e', kind: 'comment', actor: 'alice', isBot: false, summary: 'alice commented', at: '2026-10-29T10:00:00Z', display: 'muted', unseen: true, reason: '', url: null, ...overrides };
  }

  it("is true for an unread person's comment folded with the noise (agent-muted)", () => {
    expect(unreadTextLeftOut({ ...list([], []), noise: [event({})] })).toBe(true);
    expect(unreadTextLeftOut({ ...list([], []), freshNoise: [event({ kind: 'review_commented' })] })).toBe(true);
  });

  it('is false for bots, read noise and pushes', () => {
    expect(unreadTextLeftOut({ ...list([], []), noise: [event({ isBot: true, actor: 'greptile[bot]' }), event({ unseen: false }), event({ kind: 'commits_pushed' })] })).toBe(false);
  });
});
