// The fake memory loop settles like the engine's: a sync after a correction
// writes a new dossier version, a forgotten work thread is gone after a
// Refresh, and instruction proposals land under the heading they fit.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';
import { cleanPoint, headingFor, nearDuplicate, withPointPlaced } from './fake-placement.ts';

const NOW = new Date('2026-09-27T10:00:00Z');

function engine(): FakeEngine {
  return new FakeEngine({ now: () => NOW, syncStepMs: 0, sweepDelayMs: 0, recheckDelayMs: 0 });
}

describe('fake dossier rewrite on sync', () => {
  it('writes a new version without a line marked wrong and with a fixed line', async () => {
    const fake = engine();
    const before = (await fake.getTopic('topic-depot'))!.dossier!;
    const question = before.dossier.openQuestions[0]!.text;
    await fake.correctMemory({ kind: 'wrong', factId: null, topicId: 'topic-depot', text: before.dossier.goal });
    await fake.correctMemory({ kind: 'fix', factId: null, topicId: 'topic-depot', text: question, fixedText: 'Release builds stay on GitHub runners.' });
    const pending = (await fake.getTopic('topic-depot'))!.dossier!;
    expect(pending.correctedClaims).toEqual([before.dossier.goal]);
    expect(pending.fixedClaims).toEqual([{ text: question, fixed: 'Release builds stay on GitHub runners.' }]);

    await fake.sync();
    const after = (await fake.getTopic('topic-depot'))!.dossier!;
    expect(after.version).toBe(before.version + 1);
    expect(after.correctedClaims).toEqual([]);
    expect(after.fixedClaims).toEqual([]);
    expect(after.dossier.goal).toBe('');
    expect(after.dossier.openQuestions[0]?.text).toBe('Release builds stay on GitHub runners.');
    // The planted stale question goes with the rewrite, like withoutStaleClaims.
    expect(after.staleClaims).toEqual([]);
  });

  it('leaves dossiers without new corrections alone', async () => {
    const fake = engine();
    const before = (await fake.getTopic('topic-ci-tests'))?.dossier?.version;
    await fake.sync();
    expect((await fake.getTopic('topic-ci-tests'))?.dossier?.version).toBe(before);
  });
});

describe('fake work context', () => {
  it('leaves a forgotten thread out of the next Refresh', async () => {
    const fake = engine();
    const view = await fake.getWorkContext();
    const title = view.current!.threads[1]!.title;
    await fake.forgetWorkThread({ version: view.current!.version, index: 1 });
    const swept = await fake.sweepWorkContext();
    expect(swept.message).toMatch(/^Work context v\d+: 3 threads from/);
    const threads = (await fake.getWorkContext()).current!.threads;
    expect(threads.map((thread) => thread.title)).not.toContain(title);
    expect(threads.every((thread) => !thread.forgotten)).toBe(true);
  });
});

describe('fake instruction proposals', () => {
  it('notices that the instructions already say it', async () => {
    const reply = await engine().instructionsChat('From now on, tell me when something is merged without my review.');
    expect(reply.proposal).toBeNull();
    expect(reply.message.text).toBe('Your instructions already say this: "Tell me when something is merged without my review."');
  });

  it('puts a new point under What I care about, not at the end', async () => {
    const reply = await engine().instructionsChat('Always flag changes to runner labels');
    expect(reply.proposal?.text).toContain('- Always flag changes to runner labels.\n\n# What to skip');
  });
});

describe('fake placement', () => {
  const setupHeadings = ['About me', 'What I own', 'What gets routed to me', 'What to ignore or keep quiet', 'Preferences'];

  it('files a point by what it is about', () => {
    expect(headingFor('The docs repo is not mine, keep it quiet', setupHeadings, 'Preferences')).toBe('What to ignore or keep quiet');
    expect(headingFor('My team owns the release workflow', setupHeadings, 'Preferences')).toBe('What I own');
    expect(headingFor('Ping me for release workflow changes', setupHeadings, 'Preferences')).toBe('Preferences');
  });

  it('cleans a chat message into an instruction line', () => {
    expect(cleanPoint('- from now on, skip docs-only PRs')).toBe('Skip docs-only PRs.');
  });

  it('inserts at the end of the heading and finds near-duplicates', () => {
    const text = '# What I care about\n- CI cost.\n\n# What to skip\n- Bumps.\n';
    expect(withPointPlaced(text, 'Skip docs PRs.', 'What I care about')).toEqual({ text: '# What I care about\n- CI cost.\n\n# What to skip\n- Bumps.\n- Skip docs PRs.\n', heading: 'What to skip' });
    expect(nearDuplicate(text, 'CI cost')).toBe('CI cost.');
    expect(nearDuplicate(text, 'Runner labels')).toBeNull();
  });
});
