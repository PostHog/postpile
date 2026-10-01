// Comment edits (DESIGN.md "Handled quietly" › Comment edits): bots edit
// their sticky comments (CI report, review summary, test analytics) and
// GitHub keeps the thread unread for it. Each comment's latest edit is one
// `comment_edited` event, so the quiet reads can clear bot edits and a
// person's edit that adds a mention stays an ask.
import { describe, expect, it } from 'vitest';
import { deriveEvents, editMentionOf } from './events.ts';
import { at, makeComment, makeCommit, makePr, makeThreadFor, makeTimelineItem, viewer } from './fixtures.ts';
import { headlineClass } from './headline.ts';
import { isPersonalPing, pingRule } from './pings.ts';
import { isAskOfViewer, judgedReadCheck, quietReadCheck, touchedReadCheck, type QuietReadInput } from './quiet-reads.ts';
import { prTier } from './pr-tier.ts';
import type { Comment, Pr, PrEvent, Viewer } from './types.ts';
import { prWhoseTurn, unansweredAsk } from './whose-turn.ts';

function edited(overrides: Partial<Comment>): Comment {
  return makeComment({ createdAt: at(10), lastEditedAt: at(30), ...overrides });
}

function edits(pr: Pr, forViewer: Viewer = viewer): PrEvent[] {
  return deriveEvents(pr, forViewer, null).filter((event) => event.kind === 'comment_edited');
}

describe('deriveEvents: comment edits', () => {
  it('gives a person edit one quiet event at the edit time, its id carrying the edit time', () => {
    const pr = makePr({ comments: [edited({ id: 'c1', author: 'bob', editor: 'bob', body: 'looks fine, one nit' })] });
    expect(edits(pr)).toMatchObject([
      {
        id: `acme/app#1:comment_edited:c1@${at(30)}`,
        sourceId: 'c1',
        actor: 'bob',
        isBot: false,
        at: at(30),
        ruleLoudness: 'quiet',
        ruleReason: 'edited a comment',
        summary: 'bob edited a comment: looks fine, one nit',
      },
    ]);
  });

  it('gives a later edit a new id, so an edit seen before does not hide the next one', () => {
    const first = edits(makePr({ comments: [edited({ lastEditedAt: at(30) })] }))[0]!;
    const second = edits(makePr({ comments: [edited({ lastEditedAt: at(40) })] }))[0]!;
    expect(first.id).not.toBe(second.id);
    expect(edits(makePr({ comments: [edited({ lastEditedAt: at(30) })] }))[0]!.id).toBe(first.id);
  });

  it('gives no event for a comment never edited, or edited before it was posted (a pending review body)', () => {
    expect(edits(makePr({ comments: [makeComment()] }))).toEqual([]);
    expect(edits(makePr({ comments: [makeComment({ lastEditedAt: null })] }))).toEqual([]);
    expect(edits(makePr({ comments: [edited({ kind: 'review', createdAt: at(30), lastEditedAt: at(20) })] }))).toEqual([]);
  });

  it('names the author when GitHub does not say who edited', () => {
    expect(edits(makePr({ comments: [edited({ author: 'bob', editor: null })] }))[0]?.actor).toBe('bob');
  });

  it('makes a bot updating its own sticky comment quiet automation', () => {
    const pr = makePr({ comments: [edited({ author: 'github-actions[bot]', editor: 'github-actions[bot]', body: '## CI report\nAll green' })] });
    const [event] = edits(pr);
    expect(event).toMatchObject({ actor: 'github-actions[bot]', isBot: true, ruleLoudness: 'quiet', ruleReason: 'bot activity', summary: 'github-actions[bot] updated its comment: ## CI report' });
  });

  it('makes a bot editing its inline review comment quiet automation too', () => {
    const inline = edited({ id: 'rc1', kind: 'review_comment', threadId: 't1', path: 'a.ts', author: 'coderabbitai[bot]', editor: 'coderabbitai[bot]', body: 'Resolved in the latest commit' });
    const pr = makePr({ comments: [inline] });
    expect(edits(pr)[0]).toMatchObject({ isBot: true, ruleLoudness: 'quiet' });
  });

  it('makes a bot mentioning the viewer in its edited comment quiet too: automation asks nothing', () => {
    const pr = makePr({ comments: [edited({ author: 'coderabbitai[bot]', editor: 'coderabbitai[bot]', body: 'Summary for @viewer' })] });
    expect(edits(pr)[0]).toMatchObject({ isBot: true, ruleLoudness: 'quiet' });
    expect(editMentionOf(edits(pr)[0]!, pr, viewer)).toBeNull();
  });

  it('keeps the viewer editing their own comment quiet', () => {
    const pr = makePr({ comments: [edited({ author: 'viewer', editor: 'viewer', body: 'cc @viewer' })] });
    expect(edits(pr)[0]).toMatchObject({ actor: 'viewer', ruleLoudness: 'quiet', ruleReason: 'your own activity' });
  });

  it('counts a person editing a bot comment as a person', () => {
    const pr = makePr({ comments: [edited({ author: 'github-actions[bot]', editor: 'lyra', body: '## CI report\nflaky, rerun' })] });
    expect(edits(pr)[0]).toMatchObject({ actor: 'lyra', isBot: false, ruleReason: 'edited a comment' });
  });

  it('makes an edit that mentions the viewer loud and an ask', () => {
    const pr = makePr({ comments: [edited({ author: 'lyra', editor: 'lyra', body: '@viewer can you look at the cache keys?' })] });
    const [event] = edits(pr);
    expect(event).toMatchObject({ ruleLoudness: 'loud', ruleReason: 'edited to mention you', summary: 'lyra edited a comment to mention you: @viewer can you look at the cache keys?' });
    expect(editMentionOf(event!, pr, viewer)).toBe('you');
    expect(isAskOfViewer(event!, pr, viewer)).toBe(true);
  });

  it('makes an edit that mentions a home team loud, one that names only a routing team quiet', () => {
    const routing: Viewer = { ...viewer, teams: ['acme/team-platform', 'acme/approvers'], homeTeams: ['acme/team-platform'] };
    const home = makePr({ comments: [edited({ author: 'lyra', editor: 'lyra', body: 'cc @acme/team-platform' })] });
    expect(edits(home, routing)[0]).toMatchObject({ ruleLoudness: 'loud', ruleReason: 'edited to mention your team' });
    expect(editMentionOf(edits(home, routing)[0]!, home, routing)).toBe('team');
    const routed = makePr({ comments: [edited({ author: 'lyra', editor: 'lyra', body: 'cc @acme/approvers' })] });
    expect(edits(routed, routing)[0]).toMatchObject({ ruleLoudness: 'quiet', ruleReason: 'edited a comment' });
    expect(isAskOfViewer(edits(routed, routing)[0]!, routed, routing)).toBe(false);
  });

  it('makes a mention edit quiet once the viewer spoke after it', () => {
    const pr = makePr({
      comments: [edited({ id: 'c1', author: 'lyra', editor: 'lyra', body: 'cc @viewer' }), makeComment({ id: 'c2', author: 'viewer', body: 'on it', createdAt: at(35) })],
    });
    expect(edits(pr)[0]).toMatchObject({ ruleLoudness: 'quiet', ruleReason: 'you already replied' });
  });

  it('ranks a person edit with comments, a mention edit with asks, a bot edit with automation', () => {
    const pr = makePr({
      comments: [
        edited({ id: 'plain', author: 'lyra', editor: 'lyra', body: 'one more nit' }),
        edited({ id: 'ask', author: 'lyra', editor: 'lyra', body: 'cc @viewer' }),
        edited({ id: 'bot', author: 'trunk-io[bot]', editor: 'trunk-io[bot]', body: 'Test analytics' }),
      ],
    });
    const classOf = (id: string) => headlineClass(edits(pr).find((event) => event.sourceId === id)!, pr, viewer);
    expect([classOf('plain'), classOf('ask'), classOf('bot')]).toEqual([3, 0, 5]);
  });
});

describe('comment edits as asks: whose move and tier', () => {
  // ada commented at 10, the viewer answered at 20, ada edited her comment at 30 to ask the viewer.
  function adaPr(extra: Comment[] = [], body = '@viewer can you check the flag name?'): Pr {
    return makePr({
      author: 'ada',
      comments: [edited({ id: 'ask', author: 'ada', editor: 'ada', body, createdAt: at(10), lastEditedAt: at(30) }), makeComment({ id: 'mine', author: 'viewer', body: 'looks fine', createdAt: at(20) }), ...extra],
    });
  }

  it('makes an edit that now mentions the viewer an unanswered ask: reply move, Needs reply', () => {
    const pr = adaPr();
    const events = deriveEvents(pr, viewer, null);
    expect(unansweredAsk(pr, events, viewer)?.kind).toBe('comment_edited');
    expect(prWhoseTurn({ pr, events, userState: null, viewer })).toMatchObject({ kind: 'you', move: 'reply', what: 'ada mentioned you' });
    expect(prTier({ pr, events, viewer, userState: null, reason: 'subscribed' })).toBe('needs_reply');
  });

  it('is answered by a later comment of the viewer', () => {
    const pr = adaPr([makeComment({ id: 'again', author: 'viewer', body: 'renamed it', createdAt: at(40) })]);
    const events = deriveEvents(pr, viewer, null);
    expect(unansweredAsk(pr, events, viewer)).toBeNull();
    expect(prTier({ pr, events, viewer, userState: null, reason: 'subscribed' })).not.toBe('needs_reply');
  });

  it('asks like a team mention when the edit names a home team: a move until seen, not Needs reply', () => {
    const pr = adaPr([], 'cc @acme/team-platform for the flag name');
    const events = deriveEvents(pr, viewer, null);
    expect(prWhoseTurn({ pr, events, userState: null, viewer })).toMatchObject({ kind: 'you', move: 'reply', what: 'ada mentioned your team' });
    expect(prTier({ pr, events, viewer, userState: null, reason: 'subscribed' })).not.toBe('needs_reply');
    const seen = events.map((event) => ({ ...event, seenAt: at(35) }));
    expect(unansweredAsk(pr, seen, viewer)).toBeNull();
  });
});

// The real shape (an own open PR on the day, names and repo invented): every
// event seen, then four bots edit their sticky comments after the viewer's
// last read and the thread moves twice with nothing new posted.
describe('scenario: bot sticky comments edited on your own open PR', () => {
  const lastReadAt = at(180);
  const stickies: Comment[] = [
    edited({ id: 'rh', author: 'posthog[bot]', editor: 'posthog[bot]', body: 'ReviewHog: no findings', createdAt: at(90), lastEditedAt: at(185) }),
    edited({ id: 'cr', author: 'coderabbitai[bot]', editor: 'coderabbitai[bot]', body: 'Walkthrough', createdAt: at(100), lastEditedAt: at(186) }),
    edited({ id: 'ta', author: 'trunk-io[bot]', editor: 'trunk-io[bot]', body: 'Test analytics: 0 flaky', createdAt: at(110), lastEditedAt: at(190) }),
    edited({ id: 'ci', author: 'github-actions[bot]', editor: 'github-actions[bot]', body: '## CI report\nAll checks passed', createdAt: at(120), lastEditedAt: at(191) }),
  ];

  function ownPr(comments: Comment[], updatedAt = at(191)): Pr {
    return makePr({
      number: 108,
      author: viewer.login,
      reviewerUsers: ['lyra'],
      commits: [makeCommit({ oid: 'head', author: viewer.login, committedAt: at(60) })],
      timeline: [makeTimelineItem({ id: 'rq', actor: viewer.login, subject: 'lyra', at: at(61) })],
      comments,
      updatedAt,
    });
  }

  /** The sync: GitHub's read time makes everything up to it seen. */
  function synced(pr: Pr): PrEvent[] {
    return deriveEvents(pr, viewer, null).map((event) => (event.at <= lastReadAt ? { ...event, seenAt: lastReadAt } : event));
  }

  function check(pr: Pr, now: string): QuietReadInput {
    const thread = makeThreadFor(pr, { lastReadAt, updatedAt: pr.updatedAt, unread: true, reason: 'author' });
    return { thread, pr, events: synced(pr), userState: null, viewer, notYours: false, prFetchedAt: pr.updatedAt, now };
  }

  it('clears it as bot-only activity once the grace ran out', () => {
    const pr = ownPr(stickies);
    expect(quietReadCheck(check(pr, at(195)))).toEqual({ kind: 'skip', why: 'grace' });
    expect(quietReadCheck(check(pr, at(202)))).toEqual({ kind: 'mark', bots: ['posthog[bot]', 'coderabbitai[bot]', 'trunk-io[bot]', 'github-actions[bot]'] });
    expect(pingRule(synced(pr).filter((event) => event.seenAt === null), pr, viewer, false).class).toBe('bot');
  });

  it('clears a bot inline review comment on your own open PR as bot-only activity (2026-10-01)', () => {
    const finding = makeComment({ id: 'new', kind: 'review_comment', threadId: 't9', path: 'cache.ts', author: 'coderabbitai[bot]', body: 'Potential issue: the key ignores the lockfile', createdAt: at(192) });
    const pr = ownPr([...stickies, finding], at(192));
    expect(quietReadCheck(check(pr, at(210))).kind).toBe('mark');
  });

  it('keeps a person editing a comment to mention you unread and loud', () => {
    const ask = edited({ id: 'ask', author: 'lyra', editor: 'lyra', body: 'lgtm, @viewer can you drop the debug line?', createdAt: at(150), lastEditedAt: at(192) });
    const pr = ownPr([...stickies, ask], at(192));
    const input = check(pr, at(240));
    const edit = input.events.find((event) => event.sourceId === 'ask' && event.kind === 'comment_edited')!;
    expect(edit).toMatchObject({ ruleLoudness: 'loud', seenAt: null });
    expect(quietReadCheck(input)).toEqual({ kind: 'skip', why: 'human_activity' });
    expect(touchedReadCheck(input).kind).toBe('skip');
    expect(judgedReadCheck(input)).toEqual({ kind: 'skip', why: 'asks_you' });
    const ping = pingRule(input.events.filter((event) => event.seenAt === null), pr, viewer, false);
    expect(ping).toMatchObject({ class: 'addressed', event: { id: edit.id } });
    expect(isPersonalPing(edit, pr, viewer)).toBe(true);
  });
});
