// The engine over the real RunnerAgentService: prompts, zod parsing and
// short-id mapping from the agent package, answers from a FakeRunner.
import { FakeRunner, RunnerAgentService } from '@postpile/agent';
import { FakeTimers, makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { AgentCallLog } from './agent-call-log.ts';
import { Engine } from './engine.ts';
import { MarkReadQueue } from './mark-read-queue.ts';
import { PendingWrites } from './writes/pending-writes.ts';
import { FakeReader, FakeWriter, makeWrites, NOW } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

function runnerEngine(): { engine: Engine; runner: FakeRunner; reader: FakeReader; store: Store } {
  const store = Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const runner = new FakeRunner();
  const now = (): Date => NOW;
  const callLog = new AgentCallLog(store, now);
  const agent = new RunnerAgentService(runner, { now: () => NOW.toISOString(), observer: callLog });
  const writes = makeWrites(store, writer, now);
  const pendingWrites = new PendingWrites(store, writes, now);
  const markReadQueue = new MarkReadQueue(writes, reader, new FakeTimers(), undefined, () => {}, (batch) => pendingWrites.park(batch));
  const engine = new Engine({ store, reader, writes, agent, callLog, markReadQueue, pendingWrites, instructionsFile: '/nonexistent', now });
  return { engine, runner, reader, store };
}

describe('Engine over RunnerAgentService', () => {
  it('runs a full sync from canned answers, then a quiet one with no calls', async () => {
    const { engine, runner, reader } = runnerEngine();
    const pr = reviewRequestedPr(1);
    reader.addPr(pr, makeThreadFor(pr));
    runner
      .answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'Move CI to Depot', reason: 'runners' }] })
      .answer('dossier_update', {
        dossier: {
          goal: 'Run CI on Depot',
          summary: 'First PR asks for review.',
          status: 'starting',
          people: [{ login: 'alice', role: 'driver', note: 'opened it' }],
          timeline: [{ prKey: pr.key, role: 'first step' }],
        },
        facts: [
          { subject: { kind: 'person', key: 'alice' }, predicate: 'works_on', object: { kind: 'pr', key: pr.key }, text: 'alice works on #1', refs: [pr.key] },
        ],
      })
      .answer('glance_batch', {
        glances: [{ prKey: pr.key, verdict: 'LOOKS_SAFE', forYou: 'Small.', does: 'Switches runners.', risk: 'Low.', othersSaid: 'Nothing.' }],
      })
      .answer('event_classification', { overrides: [] });

    const report = await engine.sync();

    expect(report.errors).toEqual([]);
    expect(report.agentCalls).toBe(4);
    expect(report.facts.added).toBe(1);
    const [item] = await engine.listTopics();
    const detail = await engine.getTopic(item!.topic.id);
    expect(detail?.dossier?.dossier.goal).toBe('Run CI on Depot');
    expect(detail?.topic.summary).toBe('First PR asks for review.');
    const prDetail = await engine.getPr(pr.key);
    expect(prDetail?.glance).toMatchObject({ verdict: 'LOOKS_SAFE', dossierVersion: 1 });
    expect(prDetail?.glanceStale).toBe(false);
    expect(prDetail?.facts.map((view) => [view.fact.text, view.stale])).toEqual([['alice works on #1', null]]);

    reader.etag = 'etag-2';
    const quiet = await engine.sync();
    expect(quiet.errors).toEqual([]);
    expect(quiet.agentCalls).toBe(0);
  });
});
