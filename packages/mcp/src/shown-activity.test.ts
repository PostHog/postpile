import type { ActivityLine, ActivityList } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { shownActivity } from './reads.ts';

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
