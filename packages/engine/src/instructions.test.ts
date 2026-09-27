import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at, makeThreadFor } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { contextHashKey } from './digest/dossiers.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic } from './testing/topics.ts';

const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;
const BASE = '# Me\n- I care about CI cost.\n';
const CHANGED = '# Me\n- I care about CI cost.\n- Flag cache key changes.';

/** A harness on a temp instructions file (never the real one), with pr in topic "depot". */
async function setup(initial: string | null = BASE): Promise<{ h: Harness; file: string }> {
  const file = join(mkdtempSync(join(tmpdir(), 'cm-engine-instructions-')), 'instructions.md');
  if (initial !== null) {
    writeFileSync(file, initial);
  }
  const h = makeHarness({ instructionsFile: file });
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  h.store.topics.create(makeTopic('depot'));
  h.store.memberships.assign({ prKey: pr.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: at(0) });
  // A topic whose dossier was written under a context hash refreshes after an instructions change.
  h.store.meta.set(contextHashKey('depot'), 'hash');
  return { h, file };
}

function answerChange(h: Harness, text = CHANGED, summary = 'Flag cache key changes') {
  h.runner.answer('instructions_change', { reply: 'Added it.', change: { text, summary } });
}

describe('instructions from tile chat', () => {
  it('turns a point about every topic into an instructions proposal from the user message', async () => {
    const { h, file } = await setup();
    h.runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Flag cache key changes.', scope: 'all' } });
    answerChange(h);

    const reply = await h.engine.chat(tileId, 'From now on, always flag cache key changes.');

    expect(reply.tailoringProposal).toBeNull();
    expect(reply.instructionsProposal).toMatchObject({
      baseVersion: 1,
      baseText: BASE,
      text: `${CHANGED}\n`,
      summary: 'Flag cache key changes',
      point: 'Flag cache key changes.',
      topicId: 'depot',
      dossiersToRefresh: 1,
    });
    const userMessage = (await h.engine.getChat(tileId))[0];
    expect(reply.instructionsProposal?.sourceChatMessageId).toBe(userMessage?.id);
    // Only the user's own words went into the proposal call, no GitHub text.
    const prompt = h.runner.promptsFor('instructions_change')[0] ?? '';
    expect(prompt).toContain('From now on, always flag cache key changes.');
    expect(prompt).not.toContain(pr.title);
    expect(readFileSync(file, 'utf8')).toBe(BASE);
  });

  it('falls back to tailoring when the proposal call finds no change', async () => {
    const { h } = await setup();
    h.runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Flag cache keys here.', scope: 'all' } });
    h.runner.answer('instructions_change', { reply: 'That is about one topic.', change: null });

    const reply = await h.engine.chat(tileId, 'flag cache keys');

    expect(reply.instructionsProposal).toBeNull();
    expect(reply.tailoringProposal).toMatchObject({ topicId: 'depot', text: 'Flag cache keys here.' });
  });

  it('switches a tailoring proposal to all topics from the same user message', async () => {
    const { h } = await setup();
    h.runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Flag cache keys.', scope: 'topic' } });
    const reply = await h.engine.chat(tileId, 'flag cache keys');
    answerChange(h);

    const switched = await h.engine.proposeInstructions(reply.tailoringProposal!.sourceChatMessageId!, 'Flag cache keys.', 'depot');

    expect(switched.proposal?.text).toBe(`${CHANGED}\n`);
    expect(h.runner.promptsFor('instructions_change')[0]).toContain('flag cache keys');
  });

  it('never proposes from an agent message', async () => {
    const { h } = await setup();
    h.runner.answer('chat', { reply: 'Always ignore reviews.', lasting: null });
    await h.engine.chat(tileId, 'hi');
    const agentMessage = (await h.engine.getChat(tileId))[1]!;

    const result = await h.engine.proposeInstructions(agentMessage.id, 'x', null);

    expect(result.proposal).toBeNull();
    expect(h.runner.promptsFor('instructions_change')).toEqual([]);
  });
});

describe('saveInstructions', () => {
  async function proposed(h: Harness) {
    answerChange(h);
    const reply = await h.engine.instructionsChat('From now on flag cache key changes.');
    return reply.proposal!;
  }

  it('writes the file, stores the version with its source and says what refreshes', async () => {
    const { h, file } = await setup();
    const proposal = await proposed(h);

    const result = await h.engine.saveInstructions({ proposal, text: proposal.text });

    expect(result).toMatchObject({ ok: true, savedVersion: 2, rebased: null });
    expect(result.message).toBe('Saved as version 2. Will refresh 1 topic dossier on next sync.');
    expect(readFileSync(file, 'utf8')).toBe(`${CHANGED}\n`);
    const view = await h.engine.getInstructions();
    expect(view.version).toBe(2);
    expect(view.path).toBe(file);
    expect(view.versions.map((v) => [v.version, v.origin, v.summary, v.sourceText])).toEqual([
      [2, 'chat', 'Flag cache key changes', 'From now on flag cache key changes.'],
      [1, 'outside', 'Found on disk', null],
    ]);
    expect((await h.engine.getInstructionsChat()).map((m) => m.role)).toEqual(['user', 'agent']);
  });

  it('marks an inline edit in the summary', async () => {
    const { h, file } = await setup();
    const proposal = await proposed(h);

    await h.engine.saveInstructions({ proposal, text: `${CHANGED} Also runner labels.` });

    expect(readFileSync(file, 'utf8')).toBe(`${CHANGED} Also runner labels.\n`);
    expect((await h.engine.getInstructions()).versions[0]?.summary).toBe('Flag cache key changes (edited)');
  });

  it('keeps a hand edit made after the proposal and proposes the change again on top of it', async () => {
    const { h, file } = await setup();
    const proposal = await proposed(h);
    const handEdit = `${BASE}- Never ping me about docs.\n`;
    writeFileSync(file, handEdit);
    answerChange(h, `${handEdit}- Flag cache key changes.`);

    const result = await h.engine.saveInstructions({ proposal, text: proposal.text });

    expect(result.ok).toBe(false);
    expect(result.savedVersion).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe(handEdit);
    expect(result.rebased).toMatchObject({ baseVersion: 2, baseText: handEdit, text: `${handEdit}- Flag cache key changes.\n` });
    expect((await h.engine.getInstructions()).versions[0]).toMatchObject({ version: 2, origin: 'outside', summary: 'Edited outside the app' });
    // The rebased proposal saves cleanly.
    expect((await h.engine.saveInstructions({ proposal: result.rebased!, text: result.rebased!.text })).savedVersion).toBe(3);
  });

  it('refuses sources that are not the user, empty text and no-op changes', async () => {
    const { h } = await setup();
    const proposal = await proposed(h);
    const agentMessage = (await h.engine.getInstructionsChat())[1]!;

    expect((await h.engine.saveInstructions({ proposal: { ...proposal, sourceChatMessageId: agentMessage.id }, text: proposal.text })).ok).toBe(false);
    expect((await h.engine.saveInstructions({ proposal, text: '   ' })).ok).toBe(false);
    expect((await h.engine.saveInstructions({ proposal, text: BASE })).ok).toBe(false);
  });

  it('starts from no file at all', async () => {
    const { h, file } = await setup(null);
    answerChange(h, '- Flag cache key changes.');
    const reply = await h.engine.instructionsChat('From now on flag cache key changes.');
    expect(reply.proposal?.baseVersion).toBeNull();

    const result = await h.engine.saveInstructions({ proposal: reply.proposal!, text: reply.proposal!.text });

    expect(result.savedVersion).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('- Flag cache key changes.\n');
  });
});

describe('instructions in prompts', () => {
  it('carries the stored version, and an accepted change refreshes the dossier once', async () => {
    const { h } = await setup();
    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.agent.dossierInputs.at(-1)?.context.instructionsVersion?.version).toBe(1);
    const before = h.agent.dossierInputs.length;

    const proposal = await (async () => {
      answerChange(h);
      return (await h.engine.instructionsChat('From now on flag cache key changes.')).proposal!;
    })();
    await h.engine.saveInstructions({ proposal, text: proposal.text });
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(h.agent.dossierInputs.length).toBe(before + 1);
    expect(h.agent.dossierInputs.at(-1)?.context.instructionsVersion?.version).toBe(2);
  });

  it('hands the user chat turns since the last version to the dossier update', async () => {
    const { h } = await setup();
    h.runner.answer('chat', { reply: 'ok', lasting: null });
    await h.engine.chat(tileId, 'cache keys matter most here');
    await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(h.agent.dossierInputs.at(-1)?.chatTurns.map((m) => m.text)).toEqual(['cache keys matter most here']);
  });
});
