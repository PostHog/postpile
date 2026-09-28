import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

describe('without gh', () => {
  it('skips the sync with the reason, stores nothing and reads nothing from GitHub', async () => {
    const h = makeHarness();
    h.commands.missing.add('gh');
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync();

    expect(report).toMatchObject({ blockedBy: 'GitHub CLI (gh) not found', errors: [], prsFetched: 0 });
    expect(h.reader.fetchedRefs).toEqual([]);
    expect(await h.engine.lastSyncReport()).toBeNull();
    expect(await h.engine.listTopics()).toEqual([]);
  });

  it('pauses the live poll instead of failing it', async () => {
    const h = makeHarness();
    h.commands.failing.add('gh auth token');
    await h.engine.tools();

    expect(await h.engine.pollOnce()).toEqual({ kind: 'blocked', reason: 'gh is not logged in' });
  });

  it('syncs again once "Check again" finds gh working', async () => {
    const h = makeHarness();
    h.commands.missing.add('gh');
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    expect((await h.engine.sync({ maxAgentCalls: 0 })).blockedBy).toBe('GitHub CLI (gh) not found');

    h.commands.missing.clear();
    expect((await h.engine.checkTools()).canSync).toBe(true);
    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.blockedBy).toBeUndefined();
    expect(report.prsFetched).toBe(1);
  });
});

describe('without claude', () => {
  it('syncs on rules only: tiles and whose turn, no agent call, one agentOff line instead of errors', async () => {
    const h = makeHarness();
    h.commands.missing.add('claude');
    const pr = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync();

    expect(report).toMatchObject({ agentOff: 'Agent features are off: claude not found', errors: [], prsFetched: 1, agentCalls: 0 });
    expect(h.runner.requests).toEqual([]);
    const detail = await h.engine.getTopic(UNSORTED_TOPIC_ID);
    expect(detail?.tiles[0]).toMatchObject({ turn: { kind: 'you', prKey: pr.key } });
    expect(await h.engine.lastSyncReport()).toMatchObject({ agentOff: 'Agent features are off: claude not found' });
  });

  it('pings from the rules in the live poll, without a log line per cycle', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.commands.missing.add('claude');
    await h.engine.checkTools();
    const later = '2026-09-02T12:01:00.000Z';
    const next = {
      ...pr,
      updatedAt: later,
      comments: [makeComment({ id: 'm1', author: 'bob', body: `@${viewer.login} can you check the cache key?`, createdAt: '2026-09-02T11:55:00.000Z' })],
    };
    h.reader.addPr(next, makeThreadFor(next, { updatedAt: later }));
    h.reader.etag = 'etag-2';

    const cycle = await h.engine.pollOnce();

    if (cycle.kind !== 'done') throw new Error('expected a done cycle');
    expect(cycle.errors).toEqual([]);
    expect(cycle.decisions.map((decision) => [decision.source, decision.reason.startsWith('Agent features are off')])).toEqual([['fallback', true]]);
    expect(cycle.pings).toHaveLength(1);
    expect(h.runner.requests).toEqual([]);
  });

  it('skips consolidation and the work context sweep without recording a failure', async () => {
    const h = makeHarness();
    h.commands.missing.add('claude');
    await h.engine.tools();

    expect((await h.engine.consolidate()).skipped).toBe('agent_off');
    const sweep = await h.engine.sweepWorkContext();
    expect(sweep).toMatchObject({ ok: false, message: 'Work context sweep skipped. Agent features are off: claude not found.' });
    expect((await h.engine.getWorkContext()).lastError).toBeNull();
    expect(h.runner.requests).toEqual([]);
  });
});
