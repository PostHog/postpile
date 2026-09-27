import { describe, expect, it } from 'vitest';
import { chatPrompt } from './prompts/chat.ts';
import { draftCommentPrompt } from './prompts/comment.ts';
import { eventClassificationPrompt } from './prompts/events.ts';
import { glancePrompt } from './prompts/glance.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { contextBlock } from './prompts/shared.ts';
import { topicSummaryPrompt } from './prompts/summary.ts';
import { topicAssignmentPrompt } from './prompts/topics.ts';
import { emptyContext, fullContext, makeComment, makeEvent, makePr, makeTopic, viewer } from './test-fixtures.ts';

describe('contextBlock', () => {
  it('carries instructions, tailoring and feedback', () => {
    const block = contextBlock(fullContext);
    expect(block).toContain('I care about CI cost');
    expect(block).toContain('Flag anything that touches the cache keys');
    expect(block).toContain('said this is not theirs (acme/app#9): frontend PRs are never mine');
  });

  it('is empty without any memory', () => {
    expect(contextBlock(emptyContext)).toBe('');
  });
});

describe('every prompt carries the memory and asks for JSON', () => {
  const pr = makePr();
  const topic = makeTopic();
  const prompts: Record<string, string> = {
    glance: glancePrompt({ pr, viewer, provenance: { kind: 'pinged', reason: 'review_requested' }, topic, context: fullContext }),
    topics: topicAssignmentPrompt({ prs: [pr], viewer, topics: [{ id: 't1', name: 'CI', summary: '' }], context: fullContext }),
    sets: setGroupingPrompt({ topic, prs: [pr, makePr({ ref: { repo: 'acme/app', number: 2 } })], existingSets: [], context: fullContext }),
    summary: topicSummaryPrompt({ topic, prs: [pr], otherTopics: [], context: fullContext }),
    events: eventClassificationPrompt({ pr, viewer, events: [makeEvent()], context: fullContext }),
    comment: draftCommentPrompt({ pr, viewer, person: 'bob', intent: 'is the cache key stable?', context: fullContext }),
    chat: chatPrompt({
      topic,
      tile: { id: `pr:${pr.key}`, topicId: topic.id, kind: 'single', title: pr.title, members: [] },
      prs: [pr],
      history: [],
      message: 'always flag cache changes here',
      context: fullContext,
    }),
  };

  for (const [name, prompt] of Object.entries(prompts)) {
    it(name, () => {
      expect(prompt).toContain('I care about CI cost');
      expect(prompt).toContain('Flag anything that touches the cache keys');
      expect(prompt).toContain('frontend PRs are never mine');
      expect(prompt).toContain('Reply with JSON only');
    });
  }
});

describe('glancePrompt', () => {
  it('leaves bot comments out and says why a pulled-in PR is there', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'h', body: 'human concern here' }), makeComment({ id: 'b', author: 'github-actions', body: 'bot noise here' })],
    });
    const prompt = glancePrompt({ pr, viewer, provenance: { kind: 'pulled_in', reason: 'same migration' }, topic: null, context: emptyContext });
    expect(prompt).toContain('human concern here');
    expect(prompt).not.toContain('bot noise here');
    expect(prompt).toContain('pulled in for context because: same migration');
  });

  it('notes commits pushed after the user reviewed', () => {
    const pr = makePr({
      headOid: 'new',
      reviews: [{ id: 'r', author: 'viewer', state: 'APPROVED', body: '', submittedAt: '2026-09-01T00:00:00Z', commitOid: 'old' }],
    });
    const prompt = glancePrompt({ pr, viewer, provenance: { kind: 'pinged', reason: 'author' }, topic: null, context: emptyContext });
    expect(prompt).toContain("The user's own last review: approved, commits were pushed since");
  });
});

describe('setGroupingPrompt', () => {
  it('marks dissolved sets so they are not proposed again', () => {
    const prompt = setGroupingPrompt({
      topic: makeTopic(),
      prs: [makePr()],
      existingSets: [
        {
          id: 's1',
          topicId: 'topic-1',
          title: 'Old grouping',
          take: '',
          members: [{ prKey: 'acme/app#1', reason: '' }],
          removedKeys: [],
          status: 'dissolved',
          inputHash: 'h',
          createdAt: '',
          updatedAt: '',
        },
      ],
      context: emptyContext,
    });
    expect(prompt).toContain('"Old grouping" (DISSOLVED by the user');
  });
});
