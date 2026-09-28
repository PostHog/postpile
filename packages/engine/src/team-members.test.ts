import { makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { loadViewer } from './viewer-meta.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

describe('team members', () => {
  function harness() {
    let now = new Date('2026-09-28T08:00:00Z');
    const h = makeHarness({ now: () => now });
    h.reader.addPr(reviewRequestedPr(1), makeThreadFor(reviewRequestedPr(1)));
    h.reader.teams.set('acme/team-platform', ['lyra', viewer.login, 'rowan']);
    return { h, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600_000)) };
  }

  it('stores every other login on the viewer teams on the viewer', async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'rowan']);
  });

  it('refreshes at most daily, sending the stored ETag', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    advance(2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamCalls).toHaveLength(1);
    advance(23);
    h.reader.teams.set('acme/team-platform', ['lyra', viewer.login, 'rowan', 'nell']);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamCalls).toEqual([
      ['acme/team-platform', null],
      ['acme/team-platform', `team-etag:lyra,${viewer.login},rowan`],
    ]);
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'nell', 'rowan']);
  });

  it('keeps the last list when a refresh fails, and never fails the sync over it', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    advance(25);
    h.reader.teamError = new Error('network down');
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([]);
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'rowan']);
  });
});
