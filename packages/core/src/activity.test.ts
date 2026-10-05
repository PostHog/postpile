import { describe, expect, it } from 'vitest';
import { activityList, noiseLabel, noiseSummary, threadChangedAt } from './activity.ts';
import { reviewRequestSubject } from './events.ts';
import { at, makeComment, makeEvent, makePr, makeReview, makeThreadFor, viewer } from './fixtures.ts';
import type { EventDisplayState, PrEvent } from './types.ts';
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
    expect(list.noiseLabel).toBe('1 bot and other event');
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
  it('ships each event as a row draws it: no url, source id, rule loudness or seen time', () => {
    const bot = ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, summary: 'greptile commented', url: 'https://github.com/acme/app/pull/1#c', at: at(1) }, 'quiet');
    const list = activityList([bot], who);
    expect(list.noise).toEqual([
      { id: bot.event.id, kind: 'bot_comment', actor: 'greptile[bot]', summary: 'greptile commented', at: at(1), display: 'quiet', unseen: true, reason: 'comment' },
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
