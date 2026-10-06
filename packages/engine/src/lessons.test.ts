import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Glance, FullPr } from '@postpile/core';
import { makeComment, makeReview, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const GLANCED_AT = '2026-09-02T11:35:00.000Z';
const REVIEWED_AT = '2026-09-02T11:45:00.000Z';
const LINE = 'When core imports from ee/, say LOOK_CLOSER and name the import.';

function glance(pr: FullPr, overrides: Partial<Glance> = {}): Glance {
  return {
    prKey: pr.key,
    verdict: 'LOOKS_SAFE',
    forYou: 'Nothing for you.',
    does: 'Moves a helper.',
    risk: 'low - small move',
    othersSaid: '',
    keyFiles: [],
    pullInReason: null,
    dossierVersion: null,
    inputHash: 'h',
    model: 'fake',
    createdAt: GLANCED_AT,
    headOid: pr.headOid,
    ...overrides,
  };
}

const changes = makeReview({ id: 'r-me', author: viewer.login, state: 'CHANGES_REQUESTED', body: '', submittedAt: REVIEWED_AT, commitOid: 'head' });
const inline = makeComment({ id: 'c-me', author: viewer.login, kind: 'review_comment', path: 'core/x.ts', body: 'core must not import from ee/', createdAt: '2026-09-02T11:44:00.000Z' });

/** GitHub now shows this PR; the poll picks it up. */
async function onGitHub(h: Harness, pr: FullPr, at: string): Promise<void> {
  h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: at }));
  h.reader.etag = `etag-${at}`;
  await h.engine.pollOnce();
}

interface Scene {
  h: Harness;
  pr: FullPr;
  reviewed: FullPr;
  setClock: (iso: string) => void;
}

/** The PR is synced and glanced; then the viewer requests changes, with an inline comment, and the poll brings it in. */
async function requestChangesAfter(g: (pr: FullPr) => Glance): Promise<Scene> {
  let clock = new Date('2026-09-02T11:30:00.000Z');
  const instructionsFile = join(mkdtempSync(join(tmpdir(), 'cm-engine-lessons-')), 'instructions.md');
  writeFileSync(instructionsFile, '# Reviews\n- I own CI config\n');
  const h = makeHarness({ writesEnabled: false, now: () => clock, instructionsFile });
  const pr = reviewRequestedPr(1);
  topicWithPrs(h, 't', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  await h.engine.pollOnce();
  h.store.glances.put(g(pr));
  clock = new Date('2026-09-02T11:50:00.000Z');
  const reviewed: FullPr = { ...pr, updatedAt: REVIEWED_AT, reviews: [changes], comments: [inline] };
  await onGitHub(h, reviewed, REVIEWED_AT);
  return { h, pr, reviewed, setClock: (iso) => (clock = new Date(iso)) };
}

function lessonsFor(h: Harness, prKey: string) {
  return h.store.lessons.listFollowingReviewForPr(prKey);
}

describe('lessons from change requests', () => {
  it('notes a change request on a PR the glance called safe, with the glance and the inline comments, once', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));

    expect(lessonsFor(h, pr.key)).toEqual([
      expect.objectContaining({
        topicId: 't',
        source: 'review',
        mismatch: 'safety',
        status: 'new',
        glance: expect.objectContaining({ verdict: 'LOOKS_SAFE', risk: 'low - small move', headOid: pr.headOid }),
        review: expect.objectContaining({ id: 'r-me', body: '', comments: [{ id: 'c-me', path: 'core/x.ts', body: 'core must not import from ee/' }] }),
      }),
    ]);
    // Unaccepted, it reaches no prompt context: no feedback row, nothing in the topic's tailoring.
    expect(h.store.feedback.listForPr(pr.key)).toEqual([]);

    await h.engine.sync({ maxAgentCalls: 0 });
    expect(lessonsFor(h, pr.key)).toHaveLength(1);
  });

  it('leaves out a real Look closer and a review on code the glance never saw', async () => {
    const closer = await requestChangesAfter((p) => glance(p, { verdict: 'LOOK_CLOSER', risk: 'high - drops a column' }));
    expect(lessonsFor(closer.h, closer.pr.key)).toEqual([]);

    const older = await requestChangesAfter((p) => glance(p, { headOid: 'an-older-commit' }));
    expect(lessonsFor(older.h, older.pr.key)).toEqual([]);
  });

  it('starts over when the review is edited and withdraws it when the review is gone', async () => {
    const { h, pr, reviewed, setClock } = await requestChangesAfter((p) => glance(p));
    const [first] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(first!.id, { text: LINE, why: 'stated inline', status: 'open', joinedId: null });

    setClock('2026-09-02T12:10:00.000Z');
    const edited: FullPr = { ...reviewed, updatedAt: '2026-09-02T12:05:00.000Z', comments: [{ ...inline, body: 'core must never import from ee/ or cloud/' }] };
    await onGitHub(h, edited, '2026-09-02T12:05:00.000Z');
    expect(h.store.lessons.get(first!.id)).toMatchObject({ status: 'new', text: '', review: { comments: [{ body: 'core must never import from ee/ or cloud/' }] } });

    setClock('2026-09-02T12:30:00.000Z');
    const gone: FullPr = { ...edited, updatedAt: '2026-09-02T12:25:00.000Z', reviews: [] };
    await onGitHub(h, gone, '2026-09-02T12:25:00.000Z');
    expect(h.store.lessons.get(first!.id)).toMatchObject({ status: 'withdrawn' });
  });
});

describe('joined lessons follow their review', () => {
  it('restarts a joined lesson whose review was edited, and withdraws one whose review is gone', async () => {
    const { h, pr, reviewed, setClock } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    const open = h.store.lessons.add({ ...lesson!, review: null, source: 'taught', note: 'x', text: LINE, status: 'open' });
    h.store.lessons.setWritten(lesson!.id, { text: '', why: 'same as the open one', status: 'joined', joinedId: open.id });
    expect((await h.engine.getLesson(open.id))?.reviews).toBe(1);

    setClock('2026-09-02T12:10:00.000Z');
    const edited: FullPr = { ...reviewed, updatedAt: '2026-09-02T12:05:00.000Z', comments: [{ ...inline, body: 'and drop the cloud/ import too' }] };
    await onGitHub(h, edited, '2026-09-02T12:05:00.000Z');
    expect(h.store.lessons.get(lesson!.id)).toMatchObject({ status: 'new', joinedId: null });

    h.store.lessons.setWritten(lesson!.id, { text: '', why: '', status: 'joined', joinedId: open.id });
    setClock('2026-09-02T12:30:00.000Z');
    await onGitHub(h, { ...edited, updatedAt: '2026-09-02T12:25:00.000Z', reviews: [] }, '2026-09-02T12:25:00.000Z');
    expect(h.store.lessons.get(lesson!.id)?.status).toBe('withdrawn');
    expect((await h.engine.getLesson(open.id))?.reviews).toBe(0);
  });
});

describe('writing and deciding lessons', () => {
  it('writes the line in the sync and offers it in the topic; Remember in this topic puts it in the tailoring', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.runner.answer('lesson_write', { lessons: [{ id: lesson!.id, text: LINE, sameAs: null, why: 'stated in the inline comment' }] });

    await h.engine.sync({ maxAgentCalls: 20 });

    const prompt = h.runner.promptsFor('lesson_write')[0]!;
    expect(prompt).toContain('core must not import from ee/');
    const [view] = await h.engine.getLessons('t');
    expect(view).toMatchObject({ id: lesson!.id, text: LINE, earlierVerdict: 'LOOKS_SAFE', reviews: 1, prNumber: 1 });

    expect(await h.engine.getLesson(lesson!.id)).toMatchObject({ id: lesson!.id, text: LINE });
    expect((await h.engine.keepLessonForTopic(lesson!.id)).ok).toBe(true);
    expect(await h.engine.getLesson(lesson!.id)).toBeNull();
    expect(h.store.topics.get('t')?.tailoring).toBe(LINE);
    expect(h.store.lessons.get(lesson!.id)?.status).toBe('kept_topic');
    expect(await h.engine.getLessons('t')).toEqual([]);
  });

  it('never offers a dismissed line again', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    expect((await h.engine.dismissLesson(lesson!.id)).ok).toBe(true);

    const taught = await (async () => {
      h.runner.answer('lesson_write', { lessons: [{ id: lesson!.id + 1, text: 'when core imports from EE, say look_closer and name the import', sameAs: null, why: '' }] });
      return h.engine.teachLesson(pr.key, 'core should not import ee');
    })();

    expect(taught.lesson).toBeNull();
    expect(h.runner.promptsFor('lesson_write')[0]).toContain(`- ${LINE}`);
    expect(h.store.lessons.get(lesson!.id + 1)).toMatchObject({ status: 'none', source: 'taught' });
  });

  it('reads every dismissal for the check, not only the newest the prompt shows', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    expect((await h.engine.dismissLesson(lesson!.id)).ok).toBe(true);
    // Forty newer dismissals push the old one out of the prompt.
    for (let index = 0; index < 40; index += 1) {
      const filler = h.store.lessons.add({ ...lesson!, review: null, source: 'review', note: '', text: `When filler ${index}, look closer.`, status: 'open', decidedAt: null });
      h.store.lessons.decide(filler.id, 'dismissed', '', `2026-09-03T00:${String(index).padStart(2, '0')}:00.000Z`);
    }
    h.runner.answer('lesson_write', { lessons: [{ id: 41 + lesson!.id, text: LINE, sameAs: null, why: '' }] });

    const taught = await h.engine.teachLesson(pr.key, 'core should not import ee');

    expect(h.runner.promptsFor('lesson_write')[0]).not.toContain(`- ${LINE}`);
    expect(taught.lesson).toBeNull();
    expect(h.store.lessons.get(41 + lesson!.id)).toMatchObject({ status: 'none' });
  });

  it('withdraws open lessons of a retired topic', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    h.store.topics.setStatus('t', { status: 'retired', retiredAt: '2026-09-02T12:00:00.000Z' }, '2026-09-02T12:00:00.000Z');

    await h.engine.sync({ maxAgentCalls: 20 });

    expect(h.store.lessons.get(lesson!.id)?.status).toBe('withdrawn');
  });
});

describe('Use across topics', () => {
  it('proposes only an added line, saves it as a lesson version, and marks the lesson kept for all topics', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    const before = (await h.engine.getInstructions()).text;
    h.runner.answer('instructions_change', { reply: 'Added.', change: { text: `${before.trimEnd()}\n- ${LINE}`, summary: 'Look closer at ee imports' } });

    const reply = await h.engine.proposeInstructionsFromLesson(lesson!.id);

    expect(reply.proposal).toMatchObject({ sourceLessonId: lesson!.id, sourceChatMessageId: null });
    expect(h.runner.promptsFor('instructions_change')[0]).toContain('<github_data>');
    const saved = await h.engine.saveInstructions({ proposal: reply.proposal!, text: reply.proposal!.text });
    expect(saved.ok).toBe(true);
    const view = await h.engine.getInstructions();
    expect(view.text).toContain(LINE);
    expect(view.versions[0]).toMatchObject({ origin: 'lesson', sourceLessonId: lesson!.id, sourceText: LINE });
    expect(h.store.lessons.get(lesson!.id)?.status).toBe('kept_all');
  });

  it('drops a proposal that rewrites more than the lesson', async () => {
    const { h, pr } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    h.runner.answer('instructions_change', { reply: 'Rewrote it.', change: { text: `- ${LINE}\n`, summary: 'Rewrite' } });

    const reply = await h.engine.proposeInstructionsFromLesson(lesson!.id);

    expect(reply.proposal).toBeNull();
    expect(reply.reply).toContain('rewrote more than this one lesson');
    expect(h.store.lessons.get(lesson!.id)?.status).toBe('open');
  });

  it('refuses to save once the review was edited after the proposal', async () => {
    const { h, pr, reviewed, setClock } = await requestChangesAfter((p) => glance(p));
    const [lesson] = lessonsFor(h, pr.key);
    h.store.lessons.setWritten(lesson!.id, { text: LINE, why: '', status: 'open', joinedId: null });
    const before = (await h.engine.getInstructions()).text;
    h.runner.answer('instructions_change', { reply: 'Added.', change: { text: `${before.trimEnd()}\n- ${LINE}`, summary: 'Look closer at ee imports' } });
    const reply = await h.engine.proposeInstructionsFromLesson(lesson!.id);

    // Stored as the PR is now, without a poll: the check at save time reads the stored snapshot.
    setClock('2026-09-02T12:10:00.000Z');
    h.store.prs.upsert({ ...reviewed, comments: [{ ...inline, body: 'never mind' }] }, '2026-09-02T12:10:00.000Z');
    const saved = await h.engine.saveInstructions({ proposal: reply.proposal!, text: reply.proposal!.text });

    expect(saved.ok).toBe(false);
    expect(saved.message).toContain('edited');
    expect((await h.engine.getInstructions()).text).not.toContain(LINE);
    expect(h.store.lessons.get(lesson!.id)?.status).toBe('new');
  });
});
