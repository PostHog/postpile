// Overlapping edits (DESIGN.md "Overlapping edits"): the sync reads which lines
// open PRs edit, once per head, and the service names PRs that edit the same
// block of a file.
import { makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const FILE = '.github/workflows/ci.yml';

function edit(start: number, end: number) {
  return { files: [{ path: FILE, ranges: [{ start, end }] }], capped: false };
}

function harnessWithTwoPrs() {
  const h = makeHarness();
  const first = reviewRequestedPr(1);
  const second = reviewRequestedPr(2);
  h.reader.addPr(first, makeThreadFor(first));
  h.reader.addPr(second, makeThreadFor(second));
  return { h, first, second };
}

describe('overlapping edits', () => {
  it('names two open PRs that edit the same lines of a file', async () => {
    const { h } = harnessWithTwoPrs();
    h.reader.diffs.set('acme/app#1', edit(600, 620));
    h.reader.diffs.set('acme/app#2', edit(610, 640));

    await h.engine.sync({ maxAgentCalls: 0 });

    const view = await h.engine.prOverlaps();
    expect(view.overlaps['acme/app#1']).toEqual([{ other: 'acme/app#2', files: [{ path: FILE, regions: [{ start: 600, end: 640 }] }], otherCapped: false }]);
    expect(view.overlaps['acme/app#2']?.[0]?.other).toBe('acme/app#1');
    expect(view.capped).toEqual([]);
  });

  it('says nothing for edits in different places, and reads each diff once per head', async () => {
    const { h } = harnessWithTwoPrs();
    h.reader.diffs.set('acme/app#1', edit(10, 12));
    h.reader.diffs.set('acme/app#2', edit(400, 410));

    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.prOverlaps()).overlaps).toEqual({});
    expect(h.reader.diffCalls.sort()).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('skips a PR that is alone in its repo and base branch', async () => {
    const h = makeHarness();
    const alone = reviewRequestedPr(1);
    h.reader.addPr(alone, makeThreadFor(alone));

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.reader.diffCalls).toEqual([]);
  });

  it('lists a PR whose diff was cut short as capped', async () => {
    const { h } = harnessWithTwoPrs();
    h.reader.diffs.set('acme/app#1', { ...edit(1, 2), capped: true });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.prOverlaps()).capped).toEqual(['acme/app#1']);
  });

  it('leaves a PR without a diff when the read fails, and tries again next time', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const first = reviewRequestedPr(1);
    const second = reviewRequestedPr(2);
    h.reader.addPr(first, makeThreadFor(first));
    h.reader.addPr(second, makeThreadFor(second));
    h.reader.diffError = new Error('boom');

    await h.engine.sync({ maxAgentCalls: 0 });
    expect(lines.some((line) => line.includes('diff of') && line.includes('boom'))).toBe(true);
    expect(h.store.prDiffs.openWithoutCurrentDiff()).toHaveLength(2);

    h.reader.diffError = null;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.prDiffs.openWithoutCurrentDiff()).toHaveLength(0);
  });
});
