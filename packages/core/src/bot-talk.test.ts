import { describe, expect, it } from 'vitest';
import { humanDiscussion, humanReviews, isBotCommand, isBotTalk } from './bot-talk.ts';
import { memoryRole } from './event-roles.ts';
import { deriveEvents } from './events.ts';
import { at, makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import type { Comment, FullPr, PrEvent } from './types.ts';

const BOT = 'greptile-apps[bot]';

function says(body: string): Pick<Comment, 'body'> {
  return { body };
}

describe('isBotCommand', () => {
  it('takes a short line that starts with a bot handle or a slash command', () => {
    for (const body of ['@codex review', '@codex', '/trunk merge', '@coderabbitai full review', '@greptileai review this again please', '@dependabot rebase', '  @claude fix the lint  ', '@copilot[bot] review', '@mergify queue']) {
      expect(isBotCommand(says(body)), body).toBe(true);
    }
  });

  it('leaves people’s discussion alone', () => {
    for (const body of [
      'Should we ask @codex to review this?',
      '@alice can you /approve',
      '@codex review cc @alice',
      '@codex review\n\nFocus on the migration, the rest is generated.',
      '@greptileai good catch, but this would break the public API for every caller',
      '/usr/local/bin is the wrong path here',
      '@acme/team-devex review please',
      'fixed',
      '',
    ]) {
      expect(isBotCommand(says(body)), body).toBe(false);
    }
  });

  it('is never a comment without its body', () => {
    expect(isBotCommand({ body: null as unknown as string })).toBe(false);
  });
});

/** greptile opened a thread on a.ts and alice answered "fixed"; bob asks alice something in a second thread. */
function busyPr(): FullPr {
  const botThread = makeThread('t1', [
    makeComment({ id: 'g1', author: BOT, body: 'Possible null dereference', createdAt: at(1) }),
    makeComment({ id: 'a1', author: 'alice', body: 'fixed', createdAt: at(2), reviewId: 'r-a1' }),
  ]);
  const peopleThread = makeThread('t2', [
    makeComment({ id: 'b1', author: 'bob', body: 'Why not cache this?', createdAt: at(3), reviewId: 'r-b1' }),
    makeComment({ id: 'a2', author: 'alice', body: 'It is cached one level up.', createdAt: at(4), reviewId: 'r-a2' }),
  ]);
  const comments = [
    ...botThread.comments,
    ...peopleThread.comments,
    makeComment({ id: 'a3', author: 'alice', body: '@codex review', createdAt: at(5) }),
    makeComment({ id: 'b2', author: 'bob', body: 'Ship it once codex is happy.', createdAt: at(6) }),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviews = [
    makeReview({ id: 'r-a1', author: 'alice', state: 'COMMENTED', body: '', submittedAt: at(2) }),
    makeReview({ id: 'r-b1', author: 'bob', state: 'COMMENTED', body: '', submittedAt: at(3) }),
    makeReview({ id: 'r-a2', author: 'alice', state: 'COMMENTED', body: '', submittedAt: at(4) }),
    makeReview({ id: 'r-b3', author: 'bob', state: 'APPROVED', body: '', submittedAt: at(7) }),
  ];
  return makePr({ author: 'alice', comments, threads: [botThread, peopleThread], reviews });
}

describe('isBotTalk, humanDiscussion and humanReviews', () => {
  const pr = busyPr();
  const byId = (id: string) => pr.comments.find((comment) => comment.id === id)!;

  it('counts a bot’s comment, a reply in a bot-only thread and a bot command, nothing else', () => {
    expect(['g1', 'a1', 'a3'].map((id) => isBotTalk(byId(id), pr))).toEqual([true, true, true]);
    expect(['b1', 'a2', 'b2'].map((id) => isBotTalk(byId(id), pr))).toEqual([false, false, false]);
    expect(humanDiscussion(pr).map((comment) => comment.id)).toEqual(['b1', 'a2', 'b2']);
  });

  it('keeps a review that starts a thread or decides, not the empty one carrying a reply', () => {
    expect(humanReviews(pr).map((review) => review.id)).toEqual(['r-b1', 'r-b3']);
  });
});

describe('chatter events', () => {
  const pr = busyPr();
  const events = deriveEvents(pr, viewer, null);
  const event = (sourceId: string, kind?: PrEvent['kind']) => events.find((candidate) => candidate.sourceId === sourceId && (kind === undefined || candidate.kind === kind))!;

  it('marks a reply to a bot, a bot command and a carrier review, quiet, noise for topic memory', () => {
    for (const [id, reason] of [
      ['a1', 'replied to a bot in a review thread'],
      ['a3', 'a command for a bot'],
      ['r-a1', 'only carries replies in review threads'],
      ['r-a2', 'only carries replies in review threads'],
    ] as const) {
      expect(event(id).chatter, id).toBe(true);
      expect(event(id).ruleLoudness, id).toBe('quiet');
      expect(event(id).ruleReason, id).toBe(reason);
      expect(memoryRole(event(id)), id).toBe('noise');
    }
  });

  it('leaves people’s discussion alone', () => {
    for (const id of ['b1', 'a2', 'b2', 'r-b1', 'r-b3']) {
      expect(event(id).chatter, id).toBe(false);
    }
    expect(memoryRole(event('b2'))).toBe('trigger');
  });

  it('keeps a command on the viewer’s PR quiet, and one that mentions the viewer loud', () => {
    const own = makePr({ author: viewer.login, comments: [makeComment({ id: 'c1', author: 'alice', body: '@codex review', createdAt: at(1) }), makeComment({ id: 'c2', author: 'alice', body: '@codex review cc @viewer', createdAt: at(2) })] });
    const [command, mention] = deriveEvents(own, viewer, null);
    expect([command!.kind, command!.ruleLoudness, command!.chatter]).toEqual(['comment', 'quiet', true]);
    expect([mention!.kind, mention!.ruleLoudness, mention!.chatter]).toEqual(['mention', 'loud', false]);
  });

  it('marks the viewer’s own command too, so it never starts a dossier update', () => {
    const own = makePr({ author: viewer.login, comments: [makeComment({ id: 'c1', author: viewer.login, body: '/trunk merge', createdAt: at(1) })] });
    const [command] = deriveEvents(own, viewer, null);
    expect([command!.ruleReason, command!.chatter, memoryRole(command!)]).toEqual(['your own activity', true, 'noise']);
  });

  it('marks an edit of a command that mentions nobody new, not one that now mentions the viewer', () => {
    const quietEdit = makeComment({ id: 'c1', author: 'alice', body: '@codex review', createdAt: at(1), lastEditedAt: at(2) });
    const mentionEdit = makeComment({ id: 'c2', author: 'alice', body: '@codex review', createdAt: at(1), lastEditedAt: at(2) });
    const edited = makePr({ comments: [quietEdit, { ...mentionEdit, body: '@codex review, then @viewer' }] });
    const edits = deriveEvents(edited, viewer, null).filter((candidate) => candidate.kind === 'comment_edited');
    expect(edits.map((candidate) => [candidate.sourceId, candidate.chatter])).toEqual([
      ['c1', true],
      ['c2', false],
    ]);
  });
});
