import type { Pr, Topic } from '@postpile/core';
import { at, makeComment, makeReview, makeThread, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { topicChatId } from './actions/chat-actions.ts';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const thread = makeThread('T1', [
  makeComment({ id: 'RC1', author: 'bob', body: 'Why 5 retries?', createdAt: at(3) }),
  makeComment({ id: 'RC2', author: 'alice', body: 'Copied from the old worker.', createdAt: at(4) }),
]);
const question = makeComment({ id: 'IC1', author: 'bob', body: '@viewer can this land today?\n\nThe release is Thursday.', createdAt: at(5) });
const reviewBody = makeComment({ id: 'R1', author: 'carol', body: 'Needs a test for the retry limit.', kind: 'review', createdAt: at(6) });
const pr: Pr = reviewRequestedPr(1, {
  title: 'Retry the upload',
  comments: [...thread.comments, question, reviewBody],
  threads: [thread],
  reviews: [makeReview({ id: 'R1', author: 'carol', state: 'COMMENTED', body: reviewBody.body }), makeReview({ id: 'R2', author: 'dave', state: 'APPROVED', body: '' })],
});

function topic(id: string): Topic {
  return {
    id,
    name: id,
    summary: '',
    summaryInputHash: null,
    area: null,
    tailoring: '',
    driver: null,
    userRole: 'reviewer',
    status: 'active',
    kind: 'project',
    retiredAt: null,
    createdAt: at(0),
    updatedAt: at(0),
  };
}

async function synced(writesEnabled = true): Promise<Harness> {
  const h = makeHarness({ writesEnabled });
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

describe('replyToComment', () => {
  it('answers an inline comment in its review thread, as typed', async () => {
    const h = await synced();
    const result = await h.engine.replyToComment(pr.key, 'RC1', 'It matches the old worker.');
    expect(result.ok).toBe(true);
    expect(h.writer.calls).toEqual(['replyInThread T1 It matches the old worker.']);
    expect(h.telemetry.events).toContainEqual({ event: 'reply_sent', props: { target: 'thread' } });
  });

  it('answers an issue comment with a PR comment that quotes it and mentions its author', async () => {
    const h = await synced();
    const result = await h.engine.replyToComment(pr.key, 'IC1', 'Yes, after lunch.');
    expect(result.ok).toBe(true);
    expect(h.writer.calls).toEqual(['commentOnPr acme/app#1 > @viewer can this land today?\n\n@bob Yes, after lunch.']);
    expect(h.telemetry.events).toContainEqual({ event: 'reply_sent', props: { target: 'comment' } });
  });

  it('answers a review body the same way', async () => {
    const h = await synced();
    await h.engine.replyToComment(pr.key, 'R1', '@carol added one.');
    expect(h.writer.calls).toEqual(['commentOnPr acme/app#1 > Needs a test for the retry limit.\n\n@carol added one.']);
  });

  it('refuses an unknown comment, an empty reply and locked writes without calling GitHub', async () => {
    const h = await synced();
    expect((await h.engine.replyToComment(pr.key, 'nope', 'hi')).ok).toBe(false);
    expect((await h.engine.replyToComment(pr.key, 'IC1', '   ')).ok).toBe(false);
    const locked = await synced(false);
    const result = await locked.engine.replyToComment(pr.key, 'RC1', 'hi');
    expect(result).toMatchObject({ ok: false, message: 'GitHub writes are off (lock in the footer): the reply was not sent' });
    expect([...h.writer.calls, ...locked.writer.calls]).toEqual([]);
    expect(locked.telemetry.events.map((e) => e.event)).not.toContain('reply_sent');
  });
});

describe('react', () => {
  it('sends a thumbs up on a comment and marks it in the stored PR, thread included', async () => {
    const h = await synced();
    const result = await h.engine.react(pr.key, 'RC2');
    expect(result.ok).toBe(true);
    expect(h.writer.calls).toEqual(['addThumbsUp RC2']);
    const stored = h.store.prs.get(pr.key);
    expect(stored?.comments.find((c) => c.id === 'RC2')?.viewerReacted).toBe(true);
    expect(stored?.threads[0]?.comments.find((c) => c.id === 'RC2')?.viewerReacted).toBe(true);
    expect(stored?.comments.find((c) => c.id === 'RC1')?.viewerReacted).toBeUndefined();
    expect(h.telemetry.events).toContainEqual({ event: 'reaction_sent', props: {} });
  });

  it('marks the snapshot a poll stored while GitHub answered, not the one from before', async () => {
    const h = await synced();
    const send = h.writer.addThumbsUp.bind(h.writer);
    h.writer.addThumbsUp = async (subjectId) => {
      const stored = h.store.prs.get(pr.key)!;
      h.store.prs.upsert({ ...stored, title: 'Retry uploads, take two' }, at(500));
      await send(subjectId);
    };

    expect((await h.engine.react(pr.key, 'RC2')).ok).toBe(true);

    const stored = h.store.prs.get(pr.key);
    expect(stored?.title).toBe('Retry uploads, take two');
    expect(stored?.comments.find((c) => c.id === 'RC2')?.viewerReacted).toBe(true);
    expect(h.store.prs.fetchedAtByKey().get(pr.key)).toBe(at(500));
  });

  it('takes a review without a body, which is no comment', async () => {
    const h = await synced();
    expect((await h.engine.react(pr.key, 'R2')).ok).toBe(true);
    expect(h.writer.calls).toEqual(['addThumbsUp R2']);
    expect(h.store.prs.get(pr.key)?.reviews.find((r) => r.id === 'R2')?.viewerReacted).toBe(true);
  });

  it('refuses an unknown id', async () => {
    const h = await synced();
    expect((await h.engine.react(pr.key, 'nope')).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);
  });
});

describe('draftReply', () => {
  it('drafts from the whole review thread, and from the gist when given', async () => {
    const h = await synced();
    h.runner.answer('draft_comment', { body: 'It matches the old worker.' });
    h.runner.answer('draft_comment', { body: 'Five matches the old worker; lowering it later.' });

    expect(await h.engine.draftReply(pr.key, 'RC1', '')).toEqual({ body: 'It matches the old worker.' });
    await h.engine.draftReply(pr.key, 'RC1', 'five like the old worker, lower later');

    const [plain, withGist] = h.runner.promptsFor('draft_comment');
    expect(plain).toContain('@alice: Copied from the old worker.');
    expect(plain).toContain('The user did not say what to answer.');
    expect(withGist).toContain('five like the old worker, lower later');
    expect(h.writer.calls).toEqual([]);
  });

  it('throws for an unknown comment', async () => {
    const h = await synced();
    await expect(h.engine.draftReply(pr.key, 'nope', '')).rejects.toThrow('no comment nope');
  });
});

describe('topic chat', () => {
  async function inTopic(): Promise<{ h: Harness; other: Pr }> {
    const h = makeHarness();
    const other = reviewRequestedPr(2, { title: 'Upload metrics' });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.addPr(other, makeThreadFor(other));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.topics.create(topic('depot'));
    for (const key of [pr.key, other.key]) {
      h.store.memberships.assign({ prKey: key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
    }
    return { h, other };
  }

  it('stores the turn under topic:<id>, apart from tile chats, and shows the agent every PR of the topic', async () => {
    const { h } = await inTopic();
    h.runner.answer('chat', { reply: 'Two PRs, both waiting on you.', lasting: null });

    const reply = await h.engine.topicChat('depot', 'what is left here?');

    expect(reply.lastingPoint).toBeNull();
    const stored = await h.engine.getTopicChat('depot');
    expect(stored.map((m) => [m.tileId, m.topicId, m.role, m.text])).toEqual([
      [topicChatId('depot'), 'depot', 'user', 'what is left here?'],
      ['topic:depot', 'depot', 'agent', 'Two PRs, both waiting on you.'],
    ]);
    const prompt = h.runner.promptsFor('chat')[0] ?? '';
    expect(prompt).toContain('Retry the upload');
    expect(prompt).toContain('Upload metrics');
    expect(prompt).toContain('one topic and all its pull requests');
    expect(h.telemetry.events.map((e) => e.event)).toContain('chat_message_sent');
  });

  it('passes the history back and offers a lasting point for the topic', async () => {
    const { h } = await inTopic();
    h.runner.answer('chat', { reply: 'Noted.', lasting: null });
    h.runner.answer('chat', { reply: 'Will do.', lasting: { text: 'Flag retry limits.' } });
    await h.engine.topicChat('depot', 'first');

    const reply = await h.engine.topicChat('depot', 'always flag retry limits');

    expect(reply.lastingPoint).toMatchObject({ topicId: 'depot', text: 'Flag retry limits.' });
    expect(h.runner.promptsFor('chat')[1]).toContain('User: first');
  });

  it('works on Unsorted, whose lasting points have no topic to stay in', async () => {
    const h = await synced();
    h.runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Flag retry limits.' } });

    const reply = await h.engine.topicChat(UNSORTED_TOPIC_ID, 'always flag retry limits');

    expect(reply.lastingPoint).toMatchObject({ topicId: null });
    expect((await h.engine.getTopicChat(UNSORTED_TOPIC_ID)).map((m) => m.tileId)).toEqual(['topic:unsorted', 'topic:unsorted']);
    expect(h.runner.promptsFor('chat')[0]).toContain('Retry the upload');
  });

  it('throws for an unknown topic', async () => {
    const h = await synced();
    await expect(h.engine.topicChat('nope', 'hi')).rejects.toThrow('no topic nope');
  });
});
