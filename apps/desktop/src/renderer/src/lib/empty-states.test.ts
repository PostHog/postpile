import { describe, expect, it } from 'vitest';
import type { TopicDetail, TopicListItem } from '@postpile/core';
import { noSelectionText, nothingWaits } from './empty-states.ts';

const detail = (groups: string[]) => ({ tiles: groups.map((group) => ({ group })) }) as unknown as TopicDetail;
const item = (group: string) => ({ group }) as unknown as TopicListItem;

describe('noSelectionText', () => {
  it('says everything is dealt with when no tile is visible outside the fold', () => {
    expect(noSelectionText(detail(['dealt_with', 'dealt_with']))).toBe('Everything here is dealt with. Open Dealt with to look back.');
  });

  it('asks to pick a tile otherwise', () => {
    expect(noSelectionText(detail(['dealt_with', 'open']))).toBe('Pick a tile to see it.');
    expect(noSelectionText(detail([]))).toBe('Pick a tile to see it.');
    expect(noSelectionText(undefined)).toBe('Pick a tile to see it.');
  });
});

describe('nothingWaits', () => {
  it('is true only with topics and none that needs you', () => {
    expect(nothingWaits([item('quiet'), item('quiet')])).toBe(true);
    expect(nothingWaits([item('quiet'), item('needs_you')])).toBe(false);
    expect(nothingWaits([])).toBe(false);
  });
});
