import { describe, expect, it } from 'vitest';
import { activityList, noiseLabel, noiseSummary, threadChangedAt } from './activity.ts';
import { deriveEvents, reviewRequestSubject } from './events.ts';
import { at, makeComment, makeEvent, makePr, makeReview, makeThread, makeThreadFor, viewer } from './fixtures.ts';
import { eventView } from './loudness.ts';
import type { FullComment as Comment, EventDisplayState, FullPr as Pr, PrEvent } from './types.ts';
import type { EventView } from './views.ts';

const me = viewer.login;
const team = viewer.teams[0] ?? 'acme/team-platform';
const who = { ...viewer, teams: [team] };

let seq = 0;
function ev(overrides: Partial<PrEvent>, display: EventDisplayState = 'seen'): EventView {
  seq += 1;
  const loudness = display === 'loud' || display === 'muted' ? display : 'quiet';
  const base = { id: `e${seq}`, sourceId: `s${seq}`, ruleLoudness: loudness, seenAt: display === 'seen' ? at(0) : null } as const;
  return { event: makeEvent({ ...base, ...overrides }), display, unseen: display !== 'seen' && display !== 'muted' };
}

describe('activityList', () => {
  it('keeps human talk and lifecycle, folds bots into noise', () => {
    const comment = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(1) });
    const review = ev({ kind: 'review_approved', actor: 'ada', summary: 'ada approved', at: at(2) });
    const deploy = ev({ kind: 'deploy', actor: 'vercel', isBot: true, summary: 'vercel deployed', at: at(3) });
    const bot = ev({ kind: 'bot_comment', actor: 'greptile-apps[bot]', isBot: true, summary: 'greptile commented', at: at(4) });
    const merged = ev({ kind: 'merged', actor: 'ada', summary: 'ada merged', at: at(5) });
    const list = activityList([comment, review, deploy, bot, merged], who);
    expect(list.earlier.map((line) => line.summary)).toEqual(['ada merged', 'ada approved', 'lyra commented']);
    expect(list.noise.map((item) => item.summary)).toEqual(['greptile commented', 'vercel deployed']);
    expect(list.fresh).toEqual([]);
  });

  it('keeps review requests naming you or your team, drops the ones between others', () => {
    const forMe = ev({ kind: 'review_requested', actor: 'rowan', summary: `rowan requested a review from ${me}`, at: at(1) });
    const forTeam = ev({ kind: 'review_requested', actor: 'rowan', summary: `rowan requested a review from ${team}`, at: at(2) });
    const forSam = ev({ kind: 'review_requested', actor: 'rowan', summary: 'rowan requested a review from sol', at: at(3) });
    const list = activityList([forMe, forTeam, forSam], who);
    expect(list.earlier.map((line) => line.id)).toEqual([forTeam.event.id, forMe.event.id]);
    expect(list.noise.map((item) => item.id)).toEqual([forSam.event.id]);
    expect(list.noiseLabel).toBe('1 quiet event');
  });

  it('collapses a burst of pushes by one person into one line', () => {
    const pushes = [1, 2, 3].map((minute) => ev({ kind: 'commits_pushed', actor: 'rowan', summary: `rowan pushed: c${minute}`, at: at(minute) }));
    const comment = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(4) });
    const later = ev({ kind: 'commits_after_approval', actor: 'rowan', summary: 'rowan pushed: fix', at: at(5) }, 'loud');
    const list = activityList([...pushes, comment, later], who);
    expect(list.fresh.map((line) => line.summary)).toEqual(['rowan pushed: fix']);
    expect(list.earlier.map((line) => line.summary)).toEqual(['lyra commented', 'rowan pushed 3 commits']);
    expect(list.earlier[1]?.eventCount).toBe(3);
    expect(list.earlier[1]?.at).toBe(at(3));
  });

  it("links each line to its newest event's permalink, and a noise row to its own", () => {
    const pushes = [1, 2].map((minute) => ev({ kind: 'commits_pushed', actor: 'rowan', summary: 'rowan pushed: x', at: at(minute), url: `https://github.com/acme/app/pull/1/commits/c${minute}` }));
    const request = ev({ kind: 'review_requested', actor: 'rowan', summary: `rowan requested a review from ${me}`, at: at(3), url: null });
    const deploy = ev({ kind: 'deploy', actor: 'vercel', isBot: true, summary: 'vercel deployed', at: at(4), url: 'https://github.com/acme/app/pull/1#issuecomment-4' });
    const list = activityList([...pushes, request, deploy], who);
    expect(list.earlier.map((line) => line.url)).toEqual([null, 'https://github.com/acme/app/pull/1/commits/c2']);
    expect(list.noise.map((item) => item.url)).toEqual(['https://github.com/acme/app/pull/1#issuecomment-4']);
  });

  it('says when a burst came after your approval', () => {
    const pushes = [1, 2].map((minute) => ev({ kind: 'commits_after_approval', actor: 'rowan', summary: 'rowan pushed: x', at: at(minute) }, 'loud'));
    const list = activityList(pushes, who);
    expect(list.fresh.map((line) => line.summary)).toEqual(['rowan pushed 2 commits after your approval']);
    expect(list.fresh[0]?.display).toBe('loud');
  });

  it('puts new-since-you-looked lines first, apart from the rest', () => {
    const old = ev({ kind: 'comment', actor: 'lyra', summary: 'old', at: at(9) });
    const fresh = ev({ kind: 'mention', actor: 'ada', summary: 'new', at: at(1) }, 'loud');
    const list = activityList([old, fresh], who);
    expect(list.fresh.map((line) => line.summary)).toEqual(['new']);
    expect(list.earlier.map((line) => line.summary)).toEqual(['old']);
  });

  it('treats bot pushes and agent-muted events as noise', () => {
    const botPush = ev({ kind: 'commits_pushed', actor: 'renovate[bot]', isBot: true, summary: 'renovate pushed', at: at(1) });
    const muted = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(2) }, 'muted');
    const list = activityList([botPush, muted], who);
    expect(list.earlier).toEqual([]);
    expect(list.noise).toHaveLength(2);
  });

  it('labels machine-only noise as bot events', () => {
    const queue = ev({ kind: 'merge_queue', actor: '', isBot: true, summary: 'queued' });
    const deploy = ev({ kind: 'deploy', actor: 'vercel', isBot: true, summary: 'vercel deploy' });
    expect(noiseLabel([queue, deploy])).toBe('2 bot events');
  });

  it('has no label when nothing is folded', () => {
    expect(noiseLabel([])).toBe('');
  });
});

describe('activityList fresh noise', () => {
  const bot = (minutes: number, display: EventDisplayState = 'quiet') =>
    ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, summary: 'greptile commented', at: at(minutes) }, display);
  const deploy = (minutes: number) => ev({ kind: 'deploy', actor: 'vercel', isBot: true, summary: 'vercel deployed', at: at(minutes) }, 'quiet');

  it('moves unseen noise after the last touch into freshNoise while something loud is new', () => {
    const before = bot(1);
    const seen = bot(6, 'seen');
    const after = [bot(7), bot(8), deploy(9)];
    const push = ev({ kind: 'commits_pushed', actor: 'pim', summary: 'pim pushed', at: at(10) }, 'loud');
    const list = activityList([before, seen, ...after, push], who, at(5));
    expect(list.freshNoise.map((item) => item.id)).toEqual(after.map((view) => view.event.id).toReversed());
    expect(list.freshNoiseLabel).toBe('2 bot comments, a deploy');
    expect(list.noise.map((item) => item.id)).toEqual([seen.event.id, before.event.id]);
  });

  it('takes all unseen noise on a first look (no touch)', () => {
    const mention = ev({ kind: 'mention', actor: 'ada', summary: 'ada mentioned you', at: at(10) }, 'loud');
    const list = activityList([bot(1), mention], who, null);
    expect(list.freshNoise).toHaveLength(1);
    expect(list.noise).toEqual([]);
  });

  it('keeps all noise in the list while nothing loud is new', () => {
    const list = activityList([bot(1), deploy(2)], who, at(0));
    expect(list.freshNoise).toEqual([]);
    expect(list.freshNoiseLabel).toBe('');
    expect(list.noise).toHaveLength(2);
  });
});

describe('activityList items', () => {
  it('ships each event as a row draws it: its permalink, but no source id, rule loudness or seen time', () => {
    const bot = ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, summary: 'greptile commented', url: 'https://github.com/acme/app/pull/1#c', at: at(1) }, 'quiet');
    const list = activityList([bot], who);
    expect(list.noise).toEqual([
      { id: bot.event.id, kind: 'bot_comment', actor: 'greptile[bot]', summary: 'greptile commented', at: at(1), display: 'quiet', unseen: true, reason: 'comment', url: 'https://github.com/acme/app/pull/1#c' },
    ]);
  });

  it("gives the agent's reason over the rule's", () => {
    const muted = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(1), override: { loudness: 'muted', reason: 'small talk', by: 'agent' } }, 'muted');
    expect(activityList([muted], who).noise[0]?.reason).toBe('small talk');
  });

  it("gives a line the newest event's fields, the loudest display and the count", () => {
    const first = ev({ kind: 'commits_pushed', actor: 'rowan', summary: 'rowan pushed: a', at: at(1), ruleReason: 'push' });
    const second = ev({ kind: 'commits_after_approval', actor: 'rowan', summary: 'rowan pushed: b', at: at(2), ruleReason: 'after your approval' }, 'loud');
    const [line] = activityList([first, second], who).fresh;
    expect(line).toMatchObject({ id: second.event.id, kind: 'commits_after_approval', at: at(2), display: 'loud', unseen: true, reason: 'after your approval', eventCount: 2 });
    expect(line).not.toHaveProperty('events');
  });
});

describe('activityList bodies', () => {
  const longText = `First line of a long comment.\n\n${'More words. '.repeat(40)}`;

  it('carries the full body of human comments and reviews, not of bots or pushes', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'c1', author: 'lyra', body: longText }), makeComment({ id: 'c2', author: 'greptile[bot]', body: longText })],
      reviews: [makeReview({ id: 'r1', author: 'ada', body: 'Please split this up.' }), makeReview({ id: 'r2', author: 'sol', body: '' })],
    });
    const comment = ev({ kind: 'comment', actor: 'lyra', sourceId: 'c1', summary: 'lyra commented: First line of a long comment.', at: at(1) });
    const review = ev({ kind: 'review_changes_requested', actor: 'ada', sourceId: 'r1', summary: 'ada requested changes: Please split this up.', at: at(2) });
    const empty = ev({ kind: 'review_approved', actor: 'sol', sourceId: 'r2', summary: 'sol approved', at: at(3) });
    const bot = ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, sourceId: 'c2', at: at(4) });
    const push = ev({ kind: 'commits_pushed', actor: 'rowan', summary: 'rowan pushed: fix', at: at(5) });
    const list = activityList([comment, review, empty, bot, push], who, null, pr);
    const bodies = new Map(list.earlier.map((line) => [line.actor, line.body]));
    expect(bodies.get('lyra')).toBe(longText.trim());
    expect(bodies.get('ada')).toBe('Please split this up.');
    expect(bodies.get('sol')).toBeNull();
    expect(bodies.get('rowan')).toBeNull();
    expect(list.noise[0]?.actor).toBe('greptile[bot]');
  });

  it('has no body without the PR', () => {
    const comment = ev({ kind: 'comment', actor: 'lyra', sourceId: 'c1', at: at(1) });
    expect(activityList([comment], who).earlier[0]?.body).toBeNull();
  });
});

describe('unseen dots', () => {
  it('marks each line whose events are unseen, a burst when any of its events is', () => {
    const seen = ev({ kind: 'comment', actor: 'lyra', at: at(1) }, 'seen');
    const quiet = ev({ kind: 'comment', actor: 'ada', at: at(2) }, 'quiet');
    const burst = [ev({ kind: 'commits_pushed', actor: 'rowan', at: at(3) }, 'seen'), ev({ kind: 'commits_pushed', actor: 'rowan', at: at(4) }, 'quiet')];
    const list = activityList([seen, quiet, ...burst], who);
    expect(list.earlier.map((line) => [line.actor, line.unseen])).toEqual([
      ['rowan', true],
      ['ada', true],
      ['lyra', false],
    ]);
  });

  it('counts muted events as seen', () => {
    const muted = ev({ kind: 'comment', actor: 'lyra', at: at(1) }, 'muted');
    expect(muted.unseen).toBe(false);
  });
});

describe('threadChangedAt', () => {
  const pr = makePr();
  const thread = makeThreadFor(pr, { unread: true, updatedAt: at(9), lastReadAt: at(3) });

  it('says when GitHub changed an unread thread that no unseen event explains', () => {
    const seen = ev({ kind: 'comment', actor: 'lyra', at: at(5) }, 'seen');
    expect(threadChangedAt(thread, [seen])).toBe(at(9));
    expect(activityList([seen], who, null, null, thread).threadChangedAt).toBe(at(9));
  });

  it('stays quiet when an unseen loud event, or an unseen quiet one since the read, explains it', () => {
    const loud = ev({ kind: 'mention', actor: 'lyra', at: at(5) }, 'loud');
    const quietSince = ev({ kind: 'comment', actor: 'lyra', at: at(5) }, 'quiet');
    const quietBefore = ev({ kind: 'comment', actor: 'lyra', at: at(2) }, 'quiet');
    expect(threadChangedAt(thread, [loud])).toBeNull();
    expect(threadChangedAt(thread, [quietSince])).toBeNull();
    expect(threadChangedAt(thread, [quietBefore])).toBe(at(9));
  });

  it('stays quiet for a read thread or no thread', () => {
    expect(threadChangedAt({ ...thread, unread: false }, [])).toBeNull();
    expect(threadChangedAt(null, [])).toBeNull();
  });
});

describe('noiseSummary', () => {
  it('says what the noise is', () => {
    const comments = Array.from({ length: 10 }, (_, n) => ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, at: at(n) }));
    expect(noiseSummary(comments)).toBe('10 bot comments');
  });

  it('names bot pushes, deploys, the merge queue and the rest', () => {
    const push = ev({ kind: 'force_pushed', actor: 'renovate[bot]', isBot: true });
    const deploy = ev({ kind: 'deploy', actor: 'vercel', isBot: true });
    const queue = ev({ kind: 'merge_queue', actor: 'mergify[bot]', isBot: true });
    const muted = ev({ kind: 'comment', actor: 'lyra' }, 'muted');
    expect(noiseSummary([push, deploy, queue, muted])).toBe('1 bot push, a deploy, merge queue, 1 other');
  });
});

describe('reviewRequestSubject', () => {
  it('reads the requested login or team back from the summary', () => {
    expect(reviewRequestSubject('rowan requested a review from acme/team-platform')).toBe('acme/team-platform');
    expect(reviewRequestSubject('rowan removed the review request for sol')).toBe('sol');
    expect(reviewRequestSubject('rowan commented')).toBeNull();
  });
});

describe('activityList replies', () => {
  const lines = (pr: ReturnType<typeof makePr>, ...views: EventView[]) => {
    const list = activityList(views, who, null, pr);
    return [...list.fresh, ...list.earlier];
  };

  it('replies to a conversation comment with a new PR comment, and in its thread to a code comment', () => {
    const inline = makeComment({ id: 'rc1', author: 'alice', kind: 'review_comment', threadId: 't1', path: '.github/ci.yml' });
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice' }), inline] });
    const [code, plain] = lines(pr, ev({ actor: 'alice', sourceId: 'c1', at: at(1) }), ev({ actor: 'alice', sourceId: 'rc1', at: at(2) }));
    expect(plain?.reply).toEqual({ commentId: 'c1', author: 'alice', inThread: false, path: null, canReply: true, viewerReacted: false, asksYou: false });
    expect(code?.reply).toMatchObject({ commentId: 'rc1', inThread: true, path: '.github/ci.yml' });
  });

  it('asks the viewer on a question, offers only a reaction on an approval without text, carries the viewer reaction', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice', viewerReacted: true })], reviews: [makeReview({ id: 'r1', author: 'lyra' })] });
    const [review, question] = lines(pr, ev({ kind: 'question_to_user', actor: 'alice', sourceId: 'c1', at: at(1) }), ev({ kind: 'review_approved', actor: 'lyra', sourceId: 'r1', at: at(2) }));
    expect(question?.reply).toMatchObject({ commentId: 'c1', asksYou: true, viewerReacted: true });
    expect(review?.reply).toMatchObject({ commentId: 'r1', canReply: false });
  });

  it('has none for the viewer, bots, pushes or a comment the snapshot lost', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: me })] });
    const views = [
      ev({ actor: me, sourceId: 'c1', at: at(1) }),
      ev({ kind: 'comment', actor: 'alice', sourceId: 'gone', at: at(2) }),
      ev({ kind: 'commits_pushed', actor: 'alice', sourceId: 'head', at: at(3) }),
    ];
    expect(lines(pr, ...views).map((line) => line.reply)).toEqual([null, null, null]);
  });

  it('gives a comment on two lines its reply once, on the newest line, asking when either line asks', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice' }), makeComment({ id: 'c2', author: 'bob' })] });
    const mention = ev({ kind: 'mention', actor: 'alice', sourceId: 'c1', at: at(1) });
    const other = ev({ actor: 'bob', sourceId: 'c2', at: at(2) });
    const edited = ev({ kind: 'comment_edited', actor: 'alice', sourceId: 'c1', at: at(3) });
    const replies = lines(pr, mention, other, edited).map((line) => [line.id, line.reply?.commentId ?? null, line.reply?.asksYou ?? null]);
    expect(replies).toEqual([
      [edited.event.id, 'c1', true],
      [other.event.id, 'c2', false],
      [mention.event.id, null, null],
    ]);
  });

  it('has no replies without the PR or the viewer', () => {
    const view = ev({ actor: 'alice', sourceId: 'c1', at: at(1) });
    expect(activityList([view], null, null, makePr({ comments: [makeComment({ id: 'c1', author: 'alice' })] })).earlier[0]?.reply).toBeNull();
    expect(activityList([view], who).earlier[0]?.reply).toBeNull();
  });
});

describe('activityList bot threads', () => {
  const BOT = 'greptile-apps[bot]';
  const say = (id: string, author: string, minute: number, body = 'fixed') => makeComment({ id, author, body, createdAt: at(minute) });
  /** The empty review GitHub makes for each thread reply, the same second. */
  const carrier = (id: string, author: string, minute: number) => makeReview({ id, author, state: 'COMMENTED', body: '', submittedAt: at(minute) });

  function prWith(threads: Record<string, Comment[]>, extra: Partial<Pr> = {}): Pr {
    const built = Object.entries(threads).map(([id, comments]) => makeThread(id, comments));
    const comments = [...(extra.comments ?? []), ...built.flatMap((thread) => thread.comments)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return makePr({ ...extra, threads: built, comments });
  }

  /** The PR's events as the store derives them, unseen unless listed. */
  function list(pr: Pr, seen: string[] = []) {
    const views = deriveEvents(pr, who, null).map((event) => eventView(seen.includes(event.sourceId) ? { ...event, seenAt: at(100) } : event));
    return activityList(views, who, null, pr);
  }

  const lines = (pr: Pr, seen: string[] = []) => {
    const built = list(pr, seen);
    return [...built.fresh, ...built.earlier];
  };

  it("folds a person's replies in one bot thread, and the reviews GitHub made for them, into one quiet line", () => {
    const pr = prWith(
      { t1: [say('g1', BOT, 1, 'Possible null dereference'), say('a1', 'alice', 5), say('g2', BOT, 6, 'Thanks'), say('a2', 'alice', 8, 'also renamed it')] },
      { reviews: [carrier('r1', 'alice', 5), carrier('r2', 'alice', 8)] },
    );
    const [line, ...rest] = lines(pr);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      kind: 'comment',
      actor: 'alice',
      summary: `alice replied to ${BOT} · 2 replies on a.ts`,
      display: 'quiet',
      unseen: false,
      isNew: false,
      body: null,
      reply: null,
      eventCount: 4,
      thread: { to: BOT, path: 'a.ts' },
      at: at(8),
    });
    expect(line?.folded).toEqual([
      { id: 'a1', actor: 'alice', at: at(5), body: 'fixed', path: null },
      { id: 'a2', actor: 'alice', at: at(8), body: 'also renamed it', path: null },
    ]);
  });

  it('says one reply without a count, and makes one line per thread', () => {
    const pr = prWith({
      t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)],
      t2: [say('g2', BOT, 1, 'nit'), say('a2', 'alice', 3), say('a3', 'alice', 4, 'and here')],
    });
    expect(lines(pr).map((line) => line.summary)).toEqual([`alice replied to ${BOT} · 2 replies on a.ts`, `alice replied to ${BOT} on a.ts`]);
  });

  it('places the line at its newest reply, between the other lines', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('a2', 'alice', 6, 'and the test')] }, { comments: [say('c1', 'bob', 4, 'ship it'), say('c2', 'bob', 8, 'thanks')] });
    expect(lines(pr).map((line) => line.summary)).toEqual(['bob commented: thanks', `alice replied to ${BOT} · 2 replies on a.ts`, 'bob commented: ship it']);
  });

  it('keeps a reply that mentions, asks or answers the viewer a loud line of its own, with its thread', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('a2', 'alice', 3, `@${me} is this real?`)] });
    const built = list(pr);
    expect(built.fresh.map((line) => [line.kind, line.thread])).toEqual([['question_to_user', { to: BOT, path: 'a.ts' }]]);
    expect(built.fresh[0]?.reply).toMatchObject({ commentId: 'a2', asksYou: true });
    expect(built.earlier.map((line) => line.summary)).toEqual([`alice replied to ${BOT} on a.ts`]);
  });

  it("folds the viewer's own replies to a bot too", () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('v1', me, 2, 'done')] }, { author: me });
    expect(lines(pr).map((line) => line.summary)).toEqual([`${me} replied to ${BOT} on a.ts`]);
  });

  it('keeps an agent-raised reply on a line of its own', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2, 'reverted the whole thing')] });
    const views = deriveEvents(pr, who, null).map((event) =>
      eventView(event.sourceId === 'a1' && event.kind === 'comment' ? { ...event, override: { loudness: 'loud', reason: 'reverts the feature', by: 'agent' } } : event),
    );
    const built = activityList(views, who, null, pr);
    expect(built.fresh.map((line) => line.summary)).toEqual([`alice replied to ${BOT} on a.ts: reverted the whole thing`]);
    expect(built.earlier).toEqual([]);
  });

  it('shows a reply in a person\'s thread as a normal line that says whom it answers', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why the retry?'), say('g1', BOT, 2, 'agreed'), say('a1', 'alice', 3, 'flaky upload')] });
    const [reply, opener] = lines(pr);
    expect(reply).toMatchObject({ summary: 'alice replied to bob on a.ts: flaky upload', thread: { to: 'bob', path: 'a.ts' }, folded: [] });
    expect(reply?.reply).toMatchObject({ commentId: 'a1', inThread: true });
    expect(opener).toMatchObject({ summary: 'bob commented: why the retry?', thread: null });
  });

  it('starts a new line where a person joins the thread; earlier replies stay folded', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('b1', 'bob', 3, 'not fixed yet'), say('a2', 'alice', 4, 'now it is')] });
    expect(lines(pr).map((line) => line.summary)).toEqual([
      'alice replied to bob on a.ts: now it is',
      'bob replied to alice on a.ts: not fixed yet',
      `alice replied to ${BOT} on a.ts`,
    ]);
  });

  it('is seen once every reply is, and never new since you looked', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)] }, { reviews: [carrier('r1', 'alice', 2)] });
    expect(lines(pr, ['a1'])[0]?.display).toBe('seen');
    expect(lines(pr, ['r1'])[0]?.display).toBe('quiet');
  });

  it('keeps a carrier review the agent raised to loud on a new line of its own', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)] }, { reviews: [carrier('r1', 'alice', 2)] });
    const views = deriveEvents(pr, who, null).map((event) =>
      eventView(event.sourceId === 'r1' ? { ...event, override: { loudness: 'loud', reason: 'approves in all but name', by: 'agent' } } : event),
    );
    const built = activityList(views, who, null, pr);
    expect(built.fresh.map((line) => [line.kind, line.isNew])).toEqual([['review_commented', true]]);
    expect(built.earlier.map((line) => [line.summary, line.eventCount])).toEqual([[`alice replied to ${BOT} on a.ts`, 1]]);
  });

  it("puts the review GitHub made for an ask on the ask's line, not a second \"reviewed\" line", () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2, `@${me} is this real?`)] }, { reviews: [carrier('r1', 'alice', 2)] });
    const built = list(pr);
    expect([...built.fresh, ...built.earlier].map((line) => [line.kind, line.eventCount])).toEqual([['question_to_user', 2]]);
  });
});

describe('activityList carrier reviews and bot reviews', () => {
  const BOT = 'greptile-apps[bot]';

  /** An inline comment in thread `threadId` (file `src/<threadId>.ts`), with its review id when the snapshot knows it. */
  function inline(id: string, author: string, threadId: string, minute: number, body: string, reviewId?: string): Comment {
    return makeComment({ id, author, body, createdAt: at(minute), kind: 'review_comment', path: `src/${threadId}.ts`, threadId, ...(reviewId === undefined ? {} : { reviewId }) });
  }

  function emptyReview(id: string, author: string, minute: number) {
    return makeReview({ id, author, state: 'COMMENTED', body: '', submittedAt: at(minute) });
  }

  /** A PR whose threads are built from its inline comments, in order. */
  function prOf(comments: Comment[], extra: Partial<Pr> = {}): Pr {
    const threads = new Map<string, Comment[]>();
    for (const comment of comments.filter((candidate) => candidate.threadId !== null)) {
      threads.set(comment.threadId!, [...(threads.get(comment.threadId!) ?? []), comment]);
    }
    const built = [...threads.entries()].map(([id, list]) => ({ id, path: `src/${id}.ts`, isResolved: false, comments: list }));
    return makePr({ ...extra, comments: comments.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)), threads: built });
  }

  function list(pr: Pr, change: (event: PrEvent) => PrEvent = (event) => event) {
    return activityList(deriveEvents(pr, who, null).map((event) => eventView(change(event))), who, null, pr);
  }

  const allLines = (built: ReturnType<typeof activityList>) => [...built.fresh, ...built.earlier];

  /** greptile reviews with 4 inline comments; alice (the author) answers in two of the threads. */
  function greptilePr(reviewIds = true): Pr {
    const id = (value: string) => (reviewIds ? value : undefined);
    return prOf(
      [
        makeComment({ id: 'rg', author: BOT, body: 'Greptile summary: 4 comments.', createdAt: at(1), kind: 'review' }),
        inline('g1', BOT, 't1', 1, '**logic:** `build.target` drops es2019.\n\nOlder Safari fails to load.', id('rg')),
        inline('g2', BOT, 't2', 1, 'Fake timers are never reset.', id('rg')),
        inline('g3', BOT, 't3', 1, 'The port is hardcoded.', id('rg')),
        inline('g4', BOT, 't4', 1, 'Unused import.', id('rg')),
        inline('a1', 'alice', 't1', 5, 'Fixed, back to es2019.', id('ra1')),
        inline('a2', 'alice', 't1', 7, 'Also added a CI check.', id('ra2')),
        inline('a3', 'alice', 't2', 8, 'Moved the reset into afterEach.', id('ra3')),
      ],
      {
        author: 'alice',
        reviews: [
          makeReview({ id: 'rg', author: BOT, state: 'COMMENTED', body: 'Greptile summary: 4 comments.', submittedAt: at(1) }),
          emptyReview('ra1', 'alice', 5),
          emptyReview('ra2', 'alice', 7),
          emptyReview('ra3', 'alice', 8),
        ],
      },
    );
  }

  it('folds a bot review with its inline comments into one quiet line, next to the folded replies and without carrier lines', () => {
    const built = list(greptilePr());
    expect(built.fresh).toEqual([]);
    expect(built.noise).toEqual([]);
    expect(built.earlier.map((line) => [line.summary, line.fold, line.eventCount])).toEqual([
      [`alice replied to ${BOT} on src/t2.ts`, 'bot_thread', 2],
      [`alice replied to ${BOT} · 2 replies on src/t1.ts`, 'bot_thread', 4],
      [`${BOT} reviewed · 4 inline comments`, 'bot_review', 6],
    ]);
    const review = built.earlier[2]!;
    expect(review).toMatchObject({ kind: 'review_commented', actor: BOT, display: 'quiet', unseen: false, isNew: false, reply: null, thread: null, body: null });
    expect(review.folded).toEqual([
      { id: 'g1', actor: BOT, at: at(1), path: 'src/t1.ts', body: '**logic:** `build.target` drops es2019.' },
      { id: 'g2', actor: BOT, at: at(1), path: 'src/t2.ts', body: 'Fake timers are never reset.' },
      { id: 'g3', actor: BOT, at: at(1), path: 'src/t3.ts', body: 'The port is hardcoded.' },
      { id: 'g4', actor: BOT, at: at(1), path: 'src/t4.ts', body: 'Unused import.' },
    ]);
  });

  it('is never new, even while something loud is new', () => {
    const pr = greptilePr();
    const withAsk = { ...pr, comments: [...pr.comments, makeComment({ id: 'c9', author: 'bob', body: `@${me} thoughts?`, createdAt: at(20) })] };
    const built = list(withAsk);
    expect(built.fresh.map((line) => line.kind)).toEqual(['question_to_user']);
    expect(built.earlier.find((line) => line.fold === 'bot_review')).toMatchObject({ isNew: false, unseen: false });
    expect(built.freshNoise).toEqual([]);
  });

  it('keeps the bot events with the noise on an older snapshot without review ids; carriers still join their replies by time', () => {
    const built = list(greptilePr(false));
    expect(built.earlier.map((line) => [line.summary, line.eventCount])).toEqual([
      [`alice replied to ${BOT} on src/t2.ts`, 2],
      [`alice replied to ${BOT} · 2 replies on src/t1.ts`, 4],
    ]);
    expect(built.noise).toHaveLength(6);
  });

  it('keeps a bot review that mentions you, or the agent raised, with the other bot events', () => {
    const pr = greptilePr();
    const mentioning = { ...pr, comments: pr.comments.map((comment) => (comment.id === 'g4' ? { ...comment, body: `@${me} is this import needed?` } : comment)) };
    expect(list(mentioning).earlier.some((line) => line.fold === 'bot_review')).toBe(false);
    const raised = list(pr, (event) => (event.sourceId === 'rg' && event.kind === 'review_commented' ? { ...event, override: { loudness: 'loud', reason: 'flags a security hole', by: 'agent' } } : event));
    const review = raised.earlier.find((line) => line.fold === 'bot_review');
    expect(review?.eventCount).toBe(5);
    expect([...raised.noise, ...raised.freshNoise].map((item) => item.kind)).toContain('review_commented');
  });

  it('hides the carrier of a reply in a thread between people on the reply\'s line', () => {
    const pr = prOf([inline('b1', 'bob', 't1', 1, 'why the retry?', 'rb'), inline('a1', 'alice', 't1', 5, 'flaky upload', 'ra')], {
      author: me,
      reviews: [emptyReview('rb', 'bob', 1), emptyReview('ra', 'alice', 5)],
    });
    const lines = allLines(list(pr));
    expect(lines.map((line) => [line.kind, line.summary, line.eventCount])).toEqual([
      ['comment', 'alice replied to bob on src/t1.ts: flaky upload', 2],
      ['review_commented', 'bob reviewed', 1],
      ['comment', 'bob commented: why the retry?', 1],
    ]);
    expect(lines[0]?.isNew).toBe(true);
  });

  it('moves a carrier whose reply is muted to the noise', () => {
    const pr = prOf([inline('b1', 'bob', 't1', 1, 'why?', 'rb'), inline('a1', 'alice', 't1', 5, 'because', 'ra')], { reviews: [emptyReview('rb', 'bob', 1), emptyReview('ra', 'alice', 5)] });
    const built = list(pr, (event) => (event.sourceId === 'a1' ? { ...event, override: { loudness: 'muted', reason: 'noise', by: 'agent' } } : event));
    expect(allLines(built).map((line) => line.summary)).toEqual(['bob reviewed', 'bob commented: why?']);
    expect(built.noise.map((item) => item.kind).toSorted()).toEqual(['comment', 'review_commented']);
  });
});
