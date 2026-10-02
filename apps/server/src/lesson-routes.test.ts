import { describe, expect, it } from 'vitest';
import type { ActionResult, InstructionsProposalReply, InstructionsSaveResult, InstructionsView, LessonView, TeachLessonResult, TopicDetail } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const TOKEN = 'test-token';
const DEPOT = 'topic-depot';

interface TestApp {
  get<T>(path: string): Promise<{ status: number; json: T }>;
  post<T>(path: string, body?: unknown): Promise<{ status: number; json: T }>;
}

function appWithFake(engine: FakeEngine = new FakeEngine({ syncStepMs: 0 })): TestApp {
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 });
  const send = async <T>(path: string, init: RequestInit): Promise<{ status: number; json: T }> => {
    const res = await app.request(path, { ...init, headers: { 'content-type': 'application/json', [TOKEN_HEADER]: TOKEN } });
    return { status: res.status, json: (await res.json()) as T };
  };
  return {
    get: (path) => send(path, { method: 'GET' }),
    post: (path, body = {}) => send(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}

async function depotLessons(app: TestApp): Promise<LessonView[]> {
  return (await app.get<LessonView[]>(`/api/topics/${DEPOT}/lessons`)).json;
}

describe('lesson routes', () => {
  it('lists the open lessons of a topic, oldest first, and none for another topic', async () => {
    const app = appWithFake();
    const lessons = await depotLessons(app);
    expect(lessons.map((lesson) => [lesson.prNumber, lesson.source, lesson.earlierVerdict, lesson.reviews])).toEqual([
      [1921, 'review', 'LOOKS_SAFE', 2],
      [1904, 'review', 'LOOKS_SAFE', 1],
    ]);
    expect((await app.get<LessonView[]>('/api/topics/topic-ci-tests/lessons')).json).toEqual([]);
  });

  it('keeps a lesson in the topic: the line joins its tailoring and the lesson is no longer offered', async () => {
    const app = appWithFake();
    const [lesson] = await depotLessons(app);
    const kept = await app.post<ActionResult>(`/api/lessons/${lesson?.id}/keep-topic`);
    expect(kept.json).toMatchObject({ ok: true, message: 'Remembered in this topic' });
    const topic = (await app.get<TopicDetail>(`/api/topics/${DEPOT}`)).json;
    expect(topic.topic.tailoring).toContain(lesson?.text);
    expect((await depotLessons(app)).map((open) => open.id)).not.toContain(lesson?.id);
    const again = await app.post<ActionResult>(`/api/lessons/${lesson?.id}/keep-topic`);
    expect(again.json.ok).toBe(false);
  });

  it('dismisses a lesson without touching the tailoring', async () => {
    const app = appWithFake();
    const before = (await app.get<TopicDetail>(`/api/topics/${DEPOT}`)).json.topic.tailoring;
    const [lesson] = await depotLessons(app);
    expect((await app.get<LessonView | null>(`/api/lessons/${lesson?.id}`)).json).toMatchObject({ id: lesson?.id });
    expect((await app.post<ActionResult>(`/api/lessons/${lesson?.id}/dismiss`)).json).toMatchObject({ ok: true, message: 'Dismissed' });
    expect((await app.get<LessonView | null>(`/api/lessons/${lesson?.id}`)).json).toBeNull();
    expect(await depotLessons(app)).toHaveLength(1);
    expect((await app.get<TopicDetail>(`/api/topics/${DEPOT}`)).json.topic.tailoring).toBe(before);
  });

  it('proposes a lesson across topics and saves it through the instructions route as a lesson version', async () => {
    const app = appWithFake();
    const [lesson] = await depotLessons(app);
    const proposed = await app.post<InstructionsProposalReply>(`/api/lessons/${lesson?.id}/propose-instructions`);
    const proposal = proposed.json.proposal;
    expect(proposal).toMatchObject({ sourceChatMessageId: null, sourceLessonId: lesson?.id, baseVersion: 3 });
    expect(proposal?.text).toContain(`- ${lesson?.text}`);

    const saved = await app.post<InstructionsSaveResult>('/api/instructions', { proposal, text: proposal?.text });
    expect(saved.json).toMatchObject({ ok: true, savedVersion: 4 });
    const view = (await app.get<InstructionsView>('/api/instructions')).json;
    expect(view.versions[0]).toMatchObject({ version: 4, origin: 'lesson', sourceLessonId: lesson?.id, sourceChatMessageId: null, sourceText: lesson?.text });
    expect((await depotLessons(app)).map((open) => open.id)).not.toContain(lesson?.id);

    // The lesson is decided now: the same proposal cannot be saved again.
    const stale = await app.post<InstructionsSaveResult>('/api/instructions', { proposal: { ...proposal, baseVersion: 4 }, text: proposal?.text });
    expect(stale.json).toMatchObject({ ok: false, rebased: null });
  });

  it('refuses a proposal with no source or with both', async () => {
    const app = appWithFake();
    const proposal = { baseVersion: 3, baseText: '', text: 'x', summary: 'x', dossiersToRefresh: 0 };
    expect((await app.post('/api/instructions', { proposal, text: 'x' })).status).toBe(400);
    expect((await app.post('/api/instructions', { proposal: { ...proposal, sourceChatMessageId: 1, sourceLessonId: 2 }, text: 'x' })).status).toBe(400);
  });

  it('teaches a lesson from a note, which then waits in the PR topic', async () => {
    const app = appWithFake();
    const taught = await app.post<TeachLessonResult>('/api/lessons/teach', { prKey: 'acme/app#1902', note: 'Flag cache keys that drop the runner image.' });
    expect(taught.json.lesson).toMatchObject({ source: 'taught', prNumber: 1902, topicId: DEPOT, earlierVerdict: 'LOOK_CLOSER', mismatch: null });
    expect(taught.json.lesson?.text).toContain('Flag cache keys that drop the runner image');
    expect((await depotLessons(app)).map((lesson) => lesson.id)).toContain(taught.json.lesson?.id);
  });

  it('answers a very short note with a reply and no lesson', async () => {
    const app = appWithFake();
    const taught = await app.post<TeachLessonResult>('/api/lessons/teach', { prKey: 'acme/app#1902', note: 'be careful' });
    expect(taught.json.lesson).toBeNull();
    expect(taught.json.reply).toContain('Nothing reusable');
  });

  it('says why when the agent is off, for teach and for the instructions proposal', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, missingTools: ['claude'] }));
    const taught = await app.post<TeachLessonResult>('/api/lessons/teach', { prKey: 'acme/app#1902', note: 'Flag cache keys that drop the runner image.' });
    expect(taught.json.lesson).toBeNull();
    expect(taught.json.reply).not.toBe('');
    const [lesson] = await depotLessons(app);
    const proposed = await app.post<InstructionsProposalReply>(`/api/lessons/${lesson?.id}/propose-instructions`);
    expect(proposed.json.proposal).toBeNull();
    expect(proposed.json.reply).not.toBe('');
  });

  it('refuses bad ids and PR keys', async () => {
    const app = appWithFake();
    expect((await app.post('/api/lessons/abc/dismiss')).status).toBe(400);
    expect((await app.post('/api/lessons/0/keep-topic')).status).toBe(400);
    expect((await app.post('/api/lessons/teach', { prKey: 'acme/app', note: 'Flag it' })).status).toBe(400);
  });
});
