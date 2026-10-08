import { makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const CODEOWNERS = ['* @acme/team-core', '/.github/ @acme/team-platform'].join('\n');

describe('code owners', () => {
  function harness() {
    let now = new Date('2026-09-28T08:00:00Z');
    const h = makeHarness({ now: () => now });
    const pr = reviewRequestedPr(1, {
      reviewerTeams: ['acme/team-core'],
      changedFiles: 3,
      files: [
        { path: '.github/workflows/ci.yml', additions: 12, deletions: 3 },
        { path: 'src/app.ts', additions: 300, deletions: 100 },
        { path: 'src/b.ts', additions: 5, deletions: 1 },
      ],
    });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.addPr(reviewRequestedPr(2, { repo: 'acme/api' }), makeThreadFor(reviewRequestedPr(2, { repo: 'acme/api' })));
    h.reader.codeOwners.set('acme/app', { path: '.github/CODEOWNERS', oid: 'blob-1', text: CODEOWNERS });
    return { h, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600_000)) };
  }

  it("reads every open PR's repo in one call and tells the requested and home teams' files", async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.codeOwnersCalls).toEqual([['acme/api', 'acme/app']]);
    const detail = await h.engine.getPr('acme/app#1');
    expect(detail?.ownership?.owners.map((entry) => [entry.owner, entry.files.length])).toEqual([
      ['acme/team-core', 2],
      ['acme/team-platform', 1],
    ]);
    expect(detail?.ownership?.yours.map((file) => file.path)).toEqual(['.github/workflows/ci.yml']);
  });

  it('says nothing for a repo without CODEOWNERS', async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.getPr('acme/api#2'))?.ownership).toBeNull();
  });

  it('reads each repo at most once a day', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    advance(2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.codeOwnersCalls).toHaveLength(1);
    advance(23);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.codeOwnersCalls).toHaveLength(2);
  });
});
