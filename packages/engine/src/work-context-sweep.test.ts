import { FakeTimers, makeThreadFor } from '@postpile/core/fixtures';
import { SWEEP_CHECK_MS, type SweepHistory, type WorkContextSweepResult } from '@postpile/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFakeClaudeDir, userLine, type FakeClaudeDir } from './testing/claude-dir.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic } from './testing/topics.ts';
import { WorkContextSchedule } from './work-context/schedule.ts';

// The harness clock: 2026-09-02T12:00Z, which is daytime in every zone the tests run in.
const HEADING = 'What the user is working on';

let fake: FakeClaudeDir;
let h: Harness;

beforeEach(() => {
  fake = makeFakeClaudeDir();
  fake.write('.claude/CLAUDE.md', 'I work on DevEx at PostHog.');
  fake.write('.claude/projects/-Users-me-workspace-app/memory/MEMORY.md', '- [Depot](depot.md) moving CI to Depot');
  fake.session('-Users-me-workspace-app', 'a', [userLine('roll the Depot runners out to posthog', '2026-09-01T10:00:00.000Z')]);
  h = makeHarness({ claudeDir: fake.claudeDir });
  h.store.topics.create(makeTopic('depot', { name: 'Move CI to Depot', summary: 'CI runners move to Depot.' }));
});

afterEach(() => {
  fake.remove();
});

function answer(threads: unknown[] = [{ title: 'Depot rollout', detail: 'Runners to posthog.', topicIds: ['depot'], sources: ['s1', 'm1'] }]): void {
  h.runner.answer('context_sweep', { summary: 'Alice drives the Depot CI move.', threads });
}

describe('Engine.sweepWorkContext', () => {
  it('sends the collected material, instructions and topics, and stores a version with sources and stats', async () => {
    answer();

    const result = await h.engine.sweepWorkContext();

    expect(result).toMatchObject({ ok: true, version: 1 });
    const prompt = h.runner.promptsFor('context_sweep')[0] ?? '';
    expect(prompt).toContain('I work on DevEx at PostHog.');
    expect(prompt).toContain('roll the Depot runners out to posthog');
    expect(prompt).toContain('- id depot: "Move CI to Depot" - CI runners move to Depot.');
    const stored = h.store.workContext.latest();
    expect(stored?.inputSources.map((source) => source.kind)).toEqual(['claude_md', 'session', 'memory']);
    expect(stored?.inputStats).toMatchObject({ claudeMdFiles: 1, sessions: 1, memoryFiles: 1 });
    expect(stored?.digest.threads[0]?.sources.map((source) => source.kind)).toEqual(['session', 'memory']);
    expect(h.store.agentCalls.countSince('context_sweep', '2000-01-01')).toBe(1);

    const view = await h.engine.getWorkContext();
    expect(view.current?.threads[0]).toMatchObject({ title: 'Depot rollout', topics: [{ id: 'depot', name: 'Move CI to Depot' }], forgotten: false });
    expect(view.lastError).toBeNull();
  });

  it('keeps the previous version and reports the error when the call fails', async () => {
    answer();
    await h.engine.sweepWorkContext();
    h.runner.answer('context_sweep', 'not json');

    const result = await h.engine.sweepWorkContext();

    expect(result.ok).toBe(false);
    const view = await h.engine.getWorkContext();
    expect(view.current?.version).toBe(1);
    expect(view.lastError?.message).toMatch(/^Work context sweep failed/);
  });

  it('feeds the digest into topic assignment without touching any input hash', async () => {
    answer();
    await h.engine.sweepWorkContext();
    const pr = reviewRequestedPr(7);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'depot', reason: 'runners' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompt = h.runner.promptsFor('topic_assignment')[0] ?? '';
    expect(prompt).toContain(HEADING);
    expect(prompt).toContain('- Depot rollout: Runners to posthog. (topics: Move CI to Depot)');
  });

  it('Forget hides the thread from prompts, marks it in the view and tells the next sweep', async () => {
    answer([
      { title: 'Depot rollout', detail: 'Runners to posthog.', topicIds: [], sources: [] },
      { title: 'Runner image bump', detail: 'Waiting on review.', topicIds: [], sources: [] },
    ]);
    await h.engine.sweepWorkContext();

    const result = await h.engine.forgetWorkThread({ version: 1, index: 1 });

    expect(result).toMatchObject({ ok: true });
    expect(result.undoToken).toMatch(/^memory:workctx:/);
    expect((await h.engine.getWorkContext()).current?.threads.map((thread) => thread.forgotten)).toEqual([false, true]);
    answer([{ title: 'Runner image bump', detail: 'Back again.', topicIds: [], sources: [] }]);
    await h.engine.sweepWorkContext();
    expect(h.runner.promptsFor('context_sweep')[1]).toContain('- Runner image bump: Waiting on review.');
    expect(h.store.workContext.latest()?.digest.threads).toEqual([]);
  });

  it('Forget can be undone inside the window', async () => {
    answer();
    await h.engine.sweepWorkContext();
    const { undoToken } = await h.engine.forgetWorkThread({ version: 1, index: 0 });

    expect(await h.engine.undo(undoToken)).toMatchObject({ ok: true });
    expect((await h.engine.getWorkContext()).current?.threads[0]?.forgotten).toBe(false);
  });

  it('refuses a thread that is not in the digest', async () => {
    expect(await h.engine.forgetWorkThread({ version: 3, index: 0 })).toMatchObject({ ok: false });
  });
});

class FakeTarget {
  sweeps = 0;
  running = false;
  history: SweepHistory = { lastSuccessAt: null, lastFailureAt: null };

  asTarget() {
    return {
      history: () => this.history,
      isRunning: () => this.running,
      sweep: async (): Promise<WorkContextSweepResult> => {
        this.sweeps += 1;
        this.history = { lastSuccessAt: new Date(2026, 8, 28, 9).toISOString(), lastFailureAt: null };
        return { ok: true, message: '', version: this.sweeps, stats: null };
      },
    };
  }
}

describe('WorkContextSchedule', () => {
  it('checks at start and every 30 minutes, sweeping only when due', () => {
    const timers = new FakeTimers();
    let clock = new Date(2026, 8, 28, 5, 0);
    const target = new FakeTarget();
    const schedule = new WorkContextSchedule(target.asTarget(), timers, () => clock);

    schedule.start();
    expect(target.sweeps).toBe(0);

    clock = new Date(2026, 8, 28, 6, 0);
    timers.advance(SWEEP_CHECK_MS);
    expect(target.sweeps).toBe(1);

    clock = new Date(2026, 8, 28, 12, 0);
    timers.advance(SWEEP_CHECK_MS);
    expect(target.sweeps).toBe(1);

    schedule.stop();
    clock = new Date(2026, 8, 30, 12, 0);
    timers.advance(SWEEP_CHECK_MS);
    expect(target.sweeps).toBe(1);
  });

  it('does not start a second sweep while one runs', () => {
    const timers = new FakeTimers();
    const target = new FakeTarget();
    target.running = true;
    new WorkContextSchedule(target.asTarget(), timers, () => new Date(2026, 8, 28, 9)).start();
    expect(target.sweeps).toBe(0);
  });
});
