import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeCommit, makeEvent, makePr, makeReview, makeThreadFor, makeTimelineItem, makeUserState, viewer } from './fixtures.ts';
import {
  awaitsJudgement,
  botNames,
  botOnlySinceRead,
  actorsFromQuietDetail,
  botsFromQuietDetail,
  clickedReadCheck,
  clickedReadDetail,
  clickedReadNotice,
  isNewYourMove,
  judgedReadCheck,
  judgedReadDetail,
  openedReadCheck,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  quietReasonFromDetail,
  requestGoneReadCheck,
  requestGoneReadDetail,
  touchedReadCheck,
  type ClickedReadInput,
  type QuietReadInput,
  type TouchedReadInput,
} from './quiet-reads.ts';
import type { FullPr as Pr, PrEvent, Viewer } from './types.ts';
import { prWhoseTurn } from './whose-turn.ts';

const pr = makePr({ number: 7, author: 'alice' });

function botComment(minute: number, actor = 'trunk-io[bot]'): PrEvent {
  return makeEvent({ id: `bot-${minute}`, prKey: pr.key, kind: 'bot_comment', actor, isBot: true, at: at(minute), summary: `${actor} commented` });
}

function deployResult(minute: number): PrEvent {
  return makeEvent({ id: `deploy-${minute}`, prKey: pr.key, kind: 'deploy', actor: 'vercel[bot]', isBot: true, at: at(minute), summary: 'vercel[bot] deployed' });
}

function botReview(minute: number, actor = 'coderabbitai[bot]'): PrEvent {
  return makeEvent({ id: `review-${minute}`, prKey: pr.key, kind: 'review_commented', actor, isBot: true, at: at(minute), sourceId: `rv-${minute}`, summary: `${actor} reviewed` });
}

function humanComment(minute: number): PrEvent {
  return makeEvent({ id: `human-${minute}`, prKey: pr.key, kind: 'comment', actor: 'alice', isBot: false, at: at(minute) });
}

function input(overrides: Partial<QuietReadInput> = {}): QuietReadInput {
  return {
    thread: makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(31), unread: true, reason: 'subscribed' }),
    pr,
    events: [humanComment(5), botComment(30), deployResult(31)],
    userState: null,
    viewer,
    notYours: false,
    prFetchedAt: at(50),
    ...overrides,
  };
}

describe('botOnlySinceRead', () => {
  it('returns the events after the read when every one is a bot', () => {
    const events = [humanComment(5), botComment(30), deployResult(31)];
    expect(botOnlySinceRead(makePr(), events, at(20), viewer)?.map((event) => event.id)).toEqual(['bot-30', 'deploy-31']);
  });

  it('is null once a person took part after the read', () => {
    expect(botOnlySinceRead(makePr(), [botComment(30), humanComment(32)], at(20), viewer)).toBeNull();
  });

  it('is null when nothing known happened after the read', () => {
    expect(botOnlySinceRead(makePr(), [humanComment(5)], at(20), viewer)).toBeNull();
  });

  it('counts an actor-less event as a bot even when it was not flagged', () => {
    const deploy = makeEvent({ id: 'deploy', kind: 'deploy', actor: '', isBot: false, at: at(30) });
    expect(botOnlySinceRead(makePr(), [deploy], at(20), viewer)).toHaveLength(1);
  });

  it('leaves the viewer own events out: their review after the read is not someone else activity', () => {
    const ownReview = makeEvent({ id: 'own-review', prKey: pr.key, kind: 'review_approved', actor: viewer.login, at: at(25) });
    expect(botOnlySinceRead(makePr(), [ownReview, botComment(30)], at(20), viewer)?.map((event) => event.id)).toEqual(['bot-30']);
    // Only the viewer since the read: nothing by someone else is known.
    expect(botOnlySinceRead(makePr(), [ownReview], at(20), viewer)).toBeNull();
  });

  it('treats a bot-made review request that asks the viewer as a person asking, not bot activity', () => {
    const request = makeTimelineItem({ id: 'rr', actor: 'assignbot[bot]', subject: viewer.login, at: at(30) });
    const asked = makePr({ timeline: [request] });
    const event = makeEvent({ id: 'rr-event', kind: 'review_requested', actor: 'assignbot[bot]', isBot: true, sourceId: 'rr', at: at(30) });
    expect(botOnlySinceRead(asked, [event], at(20), viewer)).toBeNull();
    const otherTeam = makePr({ timeline: [{ ...request, subject: 'acme/team-web' }] });
    expect(botOnlySinceRead(otherTeam, [event], at(20), viewer)).toHaveLength(1);
  });
});

describe('botNames', () => {
  it('lists each bot once, CI for actor-less events', () => {
    expect(botNames([botComment(30), deployResult(31), botComment(32)])).toEqual(['trunk-io[bot]', 'vercel[bot]']);
  });
});

describe('quietReadCheck', () => {
  it('marks a read thread that turned unread only because of bots, naming them', () => {
    expect(quietReadCheck(input())).toEqual({ kind: 'mark', bots: ['trunk-io[bot]', 'vercel[bot]'] });
  });

  it('leaves threads alone that GitHub has read or the user never read', () => {
    expect(quietReadCheck(input({ thread: makeThreadFor(pr, { lastReadAt: at(20), unread: false }) }))).toEqual({ kind: 'skip', why: 'not_unread' });
    expect(quietReadCheck(input({ thread: makeThreadFor(pr, { lastReadAt: null, updatedAt: at(31) }) }))).toEqual({ kind: 'skip', why: 'never_read' });
  });

  it('leaves it when the PR snapshot is older than the thread or unknown', () => {
    expect(quietReadCheck(input({ prFetchedAt: null }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    // The thread moved at 31, the snapshot is from 30: a comment after it would be missing from the events.
    expect(quietReadCheck(input({ prFetchedAt: at(30) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(quietReadCheck(input({ prFetchedAt: at(31) })).kind).toBe('mark');
  });

  it('trusts a snapshot cut off at the query caps only where the raw cap evidence says what fell off is older than the read', () => {
    const cut = (capHits: Pr['capHits']) => ({ ...pr, truncated: true, capHits });
    // Read at 20: the oldest of the 60 comments that came back is at 21, so one that fell off may be after the read.
    expect(quietReadCheck(input({ pr: cut([{ list: 'comments', nodes: 60, oldestAt: at(21) }]) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(quietReadCheck(input({ pr: cut([{ list: 'comments', nodes: 60, oldestAt: at(10) }]) })).kind).toBe('mark');
    // Flagged, but no list hit its cap: GitHub counted items the query never returns.
    expect(quietReadCheck(input({ pr: cut([]) })).kind).toBe('mark');
    // Review threads at their cap never vouch, and neither does a snapshot stored without the evidence.
    expect(quietReadCheck(input({ pr: cut([{ list: 'review_threads', nodes: 50, oldestAt: null }]) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(quietReadCheck(input({ pr: cut(undefined) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(quietReadCheck(input({ pr: cut([]), prFetchedAt: at(30) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
  });

  it('leaves it when a person did something since the last read', () => {
    expect(quietReadCheck(input({ events: [botComment(30), humanComment(33)] }))).toEqual({ kind: 'skip', why: 'human_activity' });
  });

  it('marks the user own open PR after a bot review or inline comment too (2026-10-01)', () => {
    const own = { ...pr, author: viewer.login };
    expect(quietReadCheck(input({ pr: own, events: [humanComment(5), botReview(30), deployResult(31)] })).kind).toBe('mark');
    const inline = makeComment({ id: 'rc9', kind: 'review_comment', threadId: 't1', path: 'a.ts', author: 'coderabbitai[bot]', createdAt: at(30) });
    const inlineEvent = makeEvent({ id: 'inline', prKey: pr.key, kind: 'bot_comment', actor: 'coderabbitai[bot]', isBot: true, at: at(30), sourceId: 'rc9' });
    expect(quietReadCheck(input({ pr: { ...own, comments: [inline] }, events: [humanComment(5), inlineEvent, deployResult(31)] })).kind).toBe('mark');
  });

  it('marks the user own open PR when the bots only commented, ran CI or deployed (2026-09-30)', () => {
    const own = { ...pr, author: viewer.login };
    expect(quietReadCheck(input({ pr: own }))).toEqual({ kind: 'mark', bots: ['trunk-io[bot]', 'vercel[bot]'] });
  });

  it('marks the user own merged or closed PR when only bots came after the read', () => {
    const merged = { ...pr, author: viewer.login, state: 'MERGED' as const, mergedAt: at(30) };
    expect(quietReadCheck(input({ pr: merged }))).toEqual({ kind: 'mark', bots: ['trunk-io[bot]', 'vercel[bot]'] });
    const closed = { ...pr, author: viewer.login, state: 'CLOSED' as const };
    expect(quietReadCheck(input({ pr: closed })).kind).toBe('mark');
  });

  it('does not take the viewer own review after the read for a person', () => {
    const ownReview = makeEvent({ id: 'own-review', prKey: pr.key, kind: 'review_approved', actor: viewer.login, at: at(25), seenAt: at(25) });
    expect(quietReadCheck(input({ events: [humanComment(5), ownReview, botComment(30), deployResult(31)] }))).toEqual({ kind: 'mark', bots: ['trunk-io[bot]', 'vercel[bot]'] });
  });

  it('never marks a PR with an unseen merge without the user review, even when a bot merged it', () => {
    const merged = { ...pr, state: 'MERGED' as const, mergedAt: at(30) };
    const merge = makeEvent({ id: 'merge', prKey: pr.key, kind: 'merged_without_review', actor: 'trunk-io[bot]', isBot: true, at: at(30), ruleLoudness: 'quiet' });
    expect(quietReadCheck(input({ pr: merged, events: [merge] }))).toEqual({ kind: 'skip', why: 'unseen_merge' });
  });

  it('marks although the tile is unread (its thread is), but leaves it while the PR has unseen loud news', () => {
    const raised = { ...botComment(30), override: { loudness: 'loud' as const, reason: 'the finding needs a look', by: 'agent' as const } };
    expect(quietReadCheck(input({ events: [humanComment(5), raised, deployResult(31)] }))).toEqual({ kind: 'skip', why: 'unseen_loud' });
  });

  it('leaves it while the user move is new since the read, not for a move that stood before it', () => {
    const request = makeTimelineItem({ actor: 'alice', subject: viewer.login, at: at(1) });
    // A bot marked the draft ready after the read: the review asked before is a move only now.
    const readied = makePr({ number: 7, author: 'alice', reviewerUsers: [viewer.login], timeline: [request, makeTimelineItem({ id: 'rd', kind: 'ready_for_review', actor: 'readybot[bot]', subject: null, at: at(30) })] });
    const readyEvent = makeEvent({ id: 'ready', prKey: pr.key, kind: 'ready_for_review', actor: 'readybot[bot]', isBot: true, at: at(30), sourceId: 'rd' });
    expect(quietReadCheck(input({ pr: readied, events: [readyEvent, deployResult(31)] }))).toEqual({ kind: 'skip', why: 'your_move' });
    // Asked before the read and still owed: the move stood when the user read it.
    const asked = makePr({ number: 7, author: 'alice', reviewerUsers: [viewer.login], timeline: [request] });
    expect(quietReadCheck(input({ pr: asked })).kind).toBe('mark');
  });

  it('marks right away: no wait after the newest bot activity or thread update', () => {
    const justNow = makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(55), unread: true });
    expect(quietReadCheck(input({ thread: justNow, events: [humanComment(5), botComment(55)], prFetchedAt: at(55) }))).toEqual({ kind: 'mark', bots: ['trunk-io[bot]'] });
  });
});

describe('touchedReadCheck', () => {
  function own(kind: PrEvent['kind'], minute: number): PrEvent {
    return makeEvent({ id: `own-${kind}-${minute}`, prKey: pr.key, kind, actor: viewer.login, at: at(minute), seenAt: at(minute) });
  }

  // Read at 20 on GitHub; alice commented at 25 and 26; the viewer read them with Mark read in
  // PostPile at 28 (writes locked, so GitHub still says 20) and approved from the CLI at 30.
  function touched(overrides: Partial<TouchedReadInput> = {}): TouchedReadInput {
    return {
      thread: makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(30), unread: true }),
      pr,
      events: [humanComment(5), humanComment(25), humanComment(26), own('review_approved', 30)],
      userState: makeUserState({ prKey: pr.key, handledAt: at(28) }),
      viewer,
      prFetchedAt: at(50),
      ...overrides,
    };
  }

  it('marks a thread whose unread events all came before the user approval, with the reason', () => {
    expect(touchedReadCheck(touched())).toEqual({ kind: 'mark', reason: 'approved' });
  });

  it('leaves it when no read of the user covers a person event before the touch: acting is not reading (2026-09-30)', () => {
    expect(touchedReadCheck(touched({ userState: null }))).toEqual({ kind: 'skip', why: 'acted_without_seeing' });
    // A read after the touch does not count either: it came too late for the action.
    expect(touchedReadCheck(touched({ userState: makeUserState({ prKey: pr.key, handledAt: at(31) }) }))).toEqual({ kind: 'skip', why: 'acted_without_seeing' });
    // Only bots between the read and the touch: nothing to have read.
    expect(touchedReadCheck(touched({ userState: null, events: [humanComment(5), botComment(25), own('review_approved', 30)] }))).toEqual({ kind: 'mark', reason: 'approved' });
  });

  it('names the newest review or comment as the reason', () => {
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('review_changes_requested', 28)] }))).toEqual({ kind: 'mark', reason: 'changes_requested' });
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('review_commented', 28)] }))).toEqual({ kind: 'mark', reason: 'reviewed' });
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('review_approved', 27), own('comment', 28)] }))).toEqual({ kind: 'mark', reason: 'replied' });
  });

  it('takes every event when the thread was never read', () => {
    const never = makeThreadFor(pr, { lastReadAt: null, updatedAt: at(30), unread: true });
    expect(touchedReadCheck(touched({ thread: never }))).toEqual({ kind: 'mark', reason: 'approved' });
    expect(touchedReadCheck(touched({ thread: never, events: [humanComment(35), own('review_approved', 30)] }))).toEqual({ kind: 'skip', why: 'activity_after' });
  });

  it('leaves it when a person did something after the touch', () => {
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('review_approved', 30), humanComment(32)] }))).toEqual({ kind: 'skip', why: 'activity_after' });
  });

  it('never counts a push, a merge or a close as the touch', () => {
    const ownPr = { ...pr, author: viewer.login };
    expect(touchedReadCheck(touched({ pr: ownPr, events: [humanComment(25), own('commits_pushed', 30)] }))).toEqual({ kind: 'skip', why: 'no_touch' });
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('merged', 30)] }))).toEqual({ kind: 'skip', why: 'no_touch' });
  });

  it('includes the user own PR, a bot review after the touch included', () => {
    const ownPr = { ...pr, author: viewer.login };
    expect(touchedReadCheck(touched({ pr: ownPr, events: [humanComment(25), own('comment', 30)] }))).toEqual({ kind: 'mark', reason: 'replied' });
    expect(touchedReadCheck(touched({ pr: ownPr, events: [humanComment(25), own('comment', 30), deployResult(35)] }))).toEqual({ kind: 'mark', reason: 'replied' });
    expect(touchedReadCheck(touched({ pr: ownPr, events: [humanComment(25), own('comment', 30), botReview(35)] })).kind).toBe('mark');
  });

  it('lets bots after the touch pass on the user own PR once it is merged', () => {
    const merged = { ...pr, author: viewer.login, state: 'MERGED' as const, mergedAt: at(36) };
    const events = [humanComment(25), own('comment', 30), deployResult(35), botComment(36, 'trunk-io[bot]')];
    expect(touchedReadCheck(touched({ pr: merged, events }))).toEqual({ kind: 'mark', reason: 'replied' });
  });

  it('tolerates bots after the touch on someone else PR', () => {
    const events = [humanComment(25), own('review_approved', 30), botComment(45)];
    expect(touchedReadCheck(touched({ events }))).toEqual({ kind: 'mark', reason: 'approved' });
  });

  it('marks right after the touch, no wait', () => {
    expect(touchedReadCheck(touched({ prFetchedAt: at(30) }))).toEqual({ kind: 'mark', reason: 'approved' });
  });

  it('blocks on an unseen merge without the user review unless the touch came after it', () => {
    const merge = makeEvent({ id: 'merge', prKey: pr.key, kind: 'merged_without_review', actor: 'trunk-io[bot]', isBot: true, at: at(35), ruleLoudness: 'quiet' });
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('comment', 30), merge] }))).toEqual({ kind: 'skip', why: 'unseen_merge' });
    const earlyMerge = { ...merge, at: at(28) };
    expect(touchedReadCheck(touched({ events: [humanComment(25), earlyMerge, own('comment', 30)] }))).toEqual({ kind: 'mark', reason: 'replied' });
  });

  it('leaves it when the app knows of nothing unread by someone else', () => {
    expect(touchedReadCheck(touched({ events: [humanComment(5), own('review_approved', 30)] }))).toEqual({ kind: 'skip', why: 'nothing_known' });
  });

  it('leaves read threads, stale snapshots and unseen loud news alone', () => {
    expect(touchedReadCheck(touched({ thread: makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(30), unread: false }) }))).toEqual({ kind: 'skip', why: 'not_unread' });
    expect(touchedReadCheck(touched({ prFetchedAt: at(29) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    const lateComments = Array.from({ length: 60 }, (_, index) => makeComment({ id: `c${index}`, author: 'lyra', body: 'noted', createdAt: at(31) }));
    expect(touchedReadCheck(touched({ pr: { ...pr, truncated: true, comments: lateComments } }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    const raised = { ...botComment(35), override: { loudness: 'loud' as const, reason: 'the finding needs a look', by: 'agent' as const } };
    expect(touchedReadCheck(touched({ events: [humanComment(25), own('review_approved', 30), raised] }))).toEqual({ kind: 'skip', why: 'unseen_loud' });
  });
});

describe('judgedReadCheck', () => {
  const judgedQuiet = { loudness: 'quiet' as const, reason: 'a thanks, nothing to do', by: 'agent' as const };
  const teammate = (minute: number, overrides: Partial<PrEvent> = {}) =>
    makeEvent({ id: `lyra-${minute}`, prKey: pr.key, kind: 'comment', actor: 'lyra', at: at(minute), summary: 'lyra commented', ...overrides });

  // Read at 20; lyra commented at 30 and the agent judged it quiet; CI at 31.
  function judged(overrides: Partial<QuietReadInput> = {}): QuietReadInput {
    return input({ events: [humanComment(5), teammate(30, { override: judgedQuiet }), deployResult(31)], ...overrides });
  }

  it('marks when everything since the read is automation or a person the agent judged as not needing you', () => {
    expect(judgedReadCheck(judged())).toEqual({ kind: 'mark', actors: ['lyra', 'vercel[bot]'] });
    expect(judgedReadDetail(['lyra', 'vercel[bot]'])).toBe('nothing that needs you since you last looked: lyra, vercel[bot]');
    expect(quietReasonFromDetail(judgedReadDetail(['lyra', 'vercel[bot]']))).toBe('judged');
    expect(actorsFromQuietDetail(judgedReadDetail(['lyra', 'vercel[bot]']))).toEqual(['lyra', 'vercel[bot]']);
  });

  it('counts from the newer of the read and the viewer review or comment', () => {
    const neverRead = makeThreadFor(pr, { lastReadAt: null, updatedAt: at(31), unread: true });
    expect(judgedReadCheck(judged({ thread: neverRead }))).toEqual({ kind: 'skip', why: 'never_looked' });
    const ownComment = makeEvent({ id: 'own', prKey: pr.key, kind: 'comment', actor: viewer.login, at: at(25), seenAt: at(25) });
    const events = [humanComment(5), ownComment, teammate(30, { override: judgedQuiet })];
    expect(judgedReadCheck(judged({ thread: neverRead, events }))).toEqual({ kind: 'mark', actors: ['lyra'] });
  });

  it('waits for the agent: a person not judged yet, or judged as needing you, keeps it unread', () => {
    expect(judgedReadCheck(judged({ events: [teammate(30), deployResult(31)] }))).toEqual({ kind: 'skip', why: 'not_judged' });
    const raised = teammate(30, { override: { loudness: 'loud', reason: 'asks for a decision', by: 'agent' } });
    expect(judgedReadCheck(judged({ events: [raised] }))).toEqual({ kind: 'skip', why: 'unseen_loud' });
  });

  it('clears bot talk nobody judged: a reply to a bot or "@codex review" needs no agent (2026-10-06)', () => {
    const chatter = teammate(30, { chatter: true, summary: 'lyra commented: @codex review' });
    expect(awaitsJudgement(chatter, pr, viewer)).toBe(false);
    expect(judgedReadCheck(judged({ events: [chatter, deployResult(31)] }))).toEqual({ kind: 'mark', actors: ['lyra', 'vercel[bot]'] });
    // Raised by the agent or the user, it is news like any other.
    const raised = teammate(30, { chatter: true, override: { loudness: 'loud', reason: 'asks for a decision', by: 'user' } });
    expect(judgedReadCheck(judged({ events: [raised] }))).toEqual({ kind: 'skip', why: 'unseen_loud' });
    // Next to a person's comment nobody judged yet, the thread still waits.
    expect(judgedReadCheck(judged({ events: [chatter, teammate(32)] }))).toEqual({ kind: 'skip', why: 'not_judged' });
  });

  it('never clears an ask, even one the agent lowered', () => {
    const mention = teammate(30, { kind: 'mention', ruleLoudness: 'loud', override: judgedQuiet });
    expect(judgedReadCheck(judged({ events: [mention] }))).toEqual({ kind: 'skip', why: 'asks_you' });
    const request = makeEvent({ id: 'req', prKey: pr.key, kind: 'review_requested', actor: 'alice', at: at(30), sourceId: 'rr1', override: judgedQuiet });
    const asked = { ...pr, timeline: [makeTimelineItem({ id: 'rr1', actor: 'alice', subject: 'acme/team-platform', at: at(30) })] };
    const teamViewer = { ...viewer, teams: ['acme/team-platform'] };
    expect(judgedReadCheck(judged({ pr: asked, events: [request], viewer: teamViewer }))).toEqual({ kind: 'skip', why: 'asks_you' });
    const merged = { ...pr, state: 'MERGED' as const, mergedAt: at(30) };
    const merge = makeEvent({ id: 'merge', prKey: pr.key, kind: 'merged_without_review', actor: 'lyra', at: at(30), override: judgedQuiet });
    expect(judgedReadCheck(judged({ pr: merged, events: [merge] }))).toEqual({ kind: 'skip', why: 'asks_you' });
  });

  it('leaves bots-only threads to the other rules, a bot review on your own open PR included', () => {
    expect(judgedReadCheck(judged({ events: [deployResult(31)] }))).toEqual({ kind: 'skip', why: 'no_people' });
    const own = { ...pr, author: viewer.login };
    expect(judgedReadCheck(judged({ pr: own, events: [teammate(30, { override: judgedQuiet }), botReview(31)] }))).toEqual({ kind: 'mark', actors: ['lyra', 'coderabbitai[bot]'] });
    expect(judgedReadCheck(judged({ pr: own }))).toEqual({ kind: 'mark', actors: ['lyra', 'vercel[bot]'] });
  });

  it('keeps the safety checks: snapshot, a new move', () => {
    expect(judgedReadCheck(judged({ prFetchedAt: at(30) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    const request = makeTimelineItem({ actor: 'alice', subject: viewer.login, at: at(1) });
    const readied = makePr({ number: 7, author: 'alice', reviewerUsers: [viewer.login], timeline: [request, makeTimelineItem({ id: 'rd', kind: 'ready_for_review', actor: 'alice', subject: null, at: at(30) })] });
    const ready = makeEvent({ id: 'ready', prKey: pr.key, kind: 'ready_for_review', actor: 'alice', at: at(30), sourceId: 'rd', ruleLoudness: 'loud', override: judgedQuiet });
    expect(judgedReadCheck(judged({ pr: readied, events: [ready] }))).toEqual({ kind: 'skip', why: 'your_move' });
    const asked = makePr({ number: 7, author: 'alice', reviewerUsers: [viewer.login], timeline: [request] });
    expect(judgedReadCheck(judged({ pr: asked })).kind).toBe('mark');
    expect(judgedReadCheck(judged({ events: [humanComment(5)] }))).toEqual({ kind: 'skip', why: 'nothing_known' });
  });
});

describe('quiet read detail', () => {
  it('round-trips the bot names through the action log detail', () => {
    const detail = quietReadDetail(['trunk-io[bot]', 'vercel[bot]']);
    expect(detail).toBe('only bot activity since your last read: trunk-io[bot], vercel[bot]');
    expect(botsFromQuietDetail(detail)).toEqual(['trunk-io[bot]', 'vercel[bot]']);
    expect(botsFromQuietDetail('already read on GitHub')).toEqual([]);
  });

  it('round-trips the other reasons, and reads any other detail as bots', () => {
    expect(quietReasonDetail('approved')).toBe('you approved after it');
    expect(quietReasonDetail('replied')).toBe('you replied after it');
    expect(quietReasonDetail('opened')).toBe('opened in PostPile');
    expect(quietReasonFromDetail(quietReasonDetail('changes_requested'))).toBe('changes_requested');
    expect(quietReasonFromDetail(quietReasonDetail('opened'))).toBe('opened');
    expect(quietReasonFromDetail(quietReadDetail(['vercel[bot]']))).toBe('bots');
  });
});

describe('openedReadCheck', () => {
  const unreadThread = makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(30), unread: true });
  const tile = { snoozed: false };
  const opened = (overrides: Partial<Parameters<typeof openedReadCheck>[0]> = {}) =>
    openedReadCheck({ thread: unreadThread, prFetchedAt: at(30), pr, tiles: [tile], doneAfterRead: true, ...overrides });

  it('marks an unread thread when a mark-read of that PR would leave it done', () => {
    expect(opened()).toEqual({ kind: 'mark' });
  });

  it('checks the PR, not the whole tile: other PRs of a set may still ask something', () => {
    // The tile's own after-read is not an input any more; only this PR's is.
    expect(opened({ tiles: [tile, tile] })).toEqual({ kind: 'mark' });
    expect(opened({ doneAfterRead: false })).toEqual({ kind: 'skip', why: 'asks_you' });
  });

  it('never acts while a tile holding the PR is snoozed', () => {
    expect(opened({ tiles: [tile, { snoozed: true }] })).toEqual({ kind: 'skip', why: 'snoozed' });
  });

  it('only handles the PR here when GitHub has the thread read already', () => {
    expect(opened({ thread: { ...unreadThread, unread: false } })).toEqual({ kind: 'handle' });
    // Read on GitHub: an older snapshot cannot hide anything unread there.
    expect(opened({ thread: { ...unreadThread, unread: false }, prFetchedAt: at(10) })).toEqual({ kind: 'handle' });
    expect(opened({ thread: { ...unreadThread, unread: false }, doneAfterRead: false })).toEqual({ kind: 'skip', why: 'asks_you' });
  });

  it('leaves PRs without a thread or a tile, and stale snapshots of unread threads, alone', () => {
    expect(opened({ thread: null })).toEqual({ kind: 'skip', why: 'no_thread' });
    expect(opened({ tiles: [] })).toEqual({ kind: 'skip', why: 'no_tile' });
    expect(opened({ prFetchedAt: at(29) })).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(opened({ prFetchedAt: null })).toEqual({ kind: 'skip', why: 'stale_snapshot' });
  });

  it('trusts a truncated snapshot only when our caps cut nothing from the unread interval', () => {
    const commitsHit = { list: 'commits' as const, nodes: 100, oldestAt: at(25) };
    // Only GitHub's total counted more: the detail pane missed nothing.
    expect(opened({ pr: { ...pr, truncated: true, capHits: [] } })).toEqual({ kind: 'mark' });
    // Our cap cut commits after GitHub's read time (20): the user cannot have seen them.
    expect(opened({ pr: { ...pr, truncated: true, capHits: [commitsHit] } })).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    // What the cap cut is older than the read: the unread interval is all there.
    expect(opened({ pr: { ...pr, truncated: true, capHits: [{ ...commitsHit, oldestAt: at(15) }] } })).toEqual({ kind: 'mark' });
    // Stored before cap hits were recorded: no proof either way.
    expect(opened({ pr: { ...pr, truncated: true } })).toEqual({ kind: 'skip', why: 'stale_snapshot' });
  });
});

describe('clickedReadCheck', () => {
  const ownPr = makePr({ number: 7, author: viewer.login });

  function ownPush(minute: number): PrEvent {
    return makeEvent({ id: `push-${minute}`, prKey: ownPr.key, kind: 'commits_pushed', actor: viewer.login, at: at(minute) });
  }

  function clicked(overrides: Partial<ClickedReadInput> = {}): ClickedReadInput {
    return {
      thread: makeThreadFor(ownPr, { lastReadAt: at(10), updatedAt: at(40), unread: true, reason: 'author' }),
      pr: ownPr,
      events: [humanComment(5), ownPush(35)],
      viewer,
      prFetchedAt: at(45),
      shownUpTo: at(20),
      ...overrides,
    };
  }

  it('marks when only the viewer own pushes came after the click', () => {
    const check = clickedReadCheck(clicked());
    expect(check).toEqual({ kind: 'mark', bots: [] });
    expect(clickedReadDetail(check)).toBe('marked after refresh: only your own activity');
  });

  it('marks when nothing known came after the click', () => {
    expect(clickedReadCheck(clicked({ events: [humanComment(5)] }))).toEqual({ kind: 'mark', bots: [] });
  });

  it('marks a bot review on the viewer own open PR: the click was explicit, unlike the quiet reads', () => {
    const botReview = makeEvent({ id: 'bot-review', prKey: ownPr.key, kind: 'review_commented', actor: 'codex[bot]', isBot: true, at: at(38) });
    const check = clickedReadCheck(clicked({ events: [ownPush(35), botReview, deployResult(39)] }));
    expect(check).toEqual({ kind: 'mark', bots: ['codex[bot]', 'vercel[bot]'] });
    expect(clickedReadDetail(check)).toBe('marked after refresh: only your own activity and automation (codex[bot], vercel[bot])');
  });

  it('keeps it unread when a person did something after the click, naming the newest', () => {
    const review = makeEvent({ id: 'review', prKey: ownPr.key, kind: 'review_commented', actor: 'bob', at: at(37) });
    const check = clickedReadCheck(clicked({ events: [ownPush(35), humanComment(36), review, botComment(38)] }));
    expect(check).toEqual({ kind: 'keep', why: 'people', news: [review, humanComment(36)] });
    expect(clickedReadDetail(check)).toBe('kept unread: new review from bob and 1 more');
    expect(clickedReadNotice(check)).toBe('New since you looked: a review from bob and 1 more');
  });

  it('ignores a person activity up to what the click showed', () => {
    expect(clickedReadCheck(clicked({ events: [humanComment(20), ownPush(35)] })).kind).toBe('mark');
  });

  it('keeps it unread while the snapshot does not cover the thread', () => {
    const check = clickedReadCheck(clicked({ prFetchedAt: at(39) }));
    expect(check).toEqual({ kind: 'keep', why: 'stale_snapshot' });
    expect(clickedReadDetail(check)).toBe('kept unread: activity after the last sync');
    expect(clickedReadNotice(check)).toBe('New activity on GitHub since you looked: still unread');
  });
});

// The real case of 2026-09-30 (names and repo invented): the viewer's own PR
// (a coding agent opened it and assigned them), approved by the viewer on
// Sep 15, read on GitHub on Sep 18. Then rowan removed a team review request
// (the events agent judged it quiet), a stale-PR bot nudged and CI ran. On
// Sep 18 the PR still waited on the team, so "Merge, it is approved" is new,
// but merging asks nothing: only new moves that are asks block, and the
// judged read clears it.
describe('scenario: own approved PR, only old moves and bot nudges since the read', () => {
  const day = (date: number, hour = 12) => new Date(Date.UTC(2026, 8, date, hour)).toISOString();
  const lastReadAt = day(18);
  const judgedQuiet = { loudness: 'quiet' as const, reason: 'housekeeping, nothing for you', by: 'agent' as const };

  function agentPr(extra: Partial<Pr> = {}): Pr {
    return makePr({
      number: 210,
      author: 'acme-agent[bot]',
      assignees: [viewer.login],
      reviewDecision: 'APPROVED',
      commits: [makeCommit({ oid: 'head', author: 'acme-agent[bot]', committedAt: day(10) })],
      reviews: [makeReview({ id: 'mine', author: viewer.login, state: 'APPROVED', submittedAt: day(15), commitOid: 'head' })],
      timeline: [
        makeTimelineItem({ id: 'rq', actor: 'acme-agent[bot]', subject: 'acme/team-infra', at: day(10) }),
        makeTimelineItem({ id: 'rm', kind: 'review_request_removed', actor: 'rowan', subject: 'acme/team-infra', at: day(22) }),
      ],
      comments: [makeComment({ id: 'nudge', author: 'stale-nudge[bot]', body: 'This PR has been open for 14 days', createdAt: day(30, 10) })],
      updatedAt: day(30, 11),
      ...extra,
    });
  }

  /** The sync: everything up to GitHub's read time seen; the agent judged rowan's removal quiet. */
  function caseInput(realPr: Pr): QuietReadInput {
    const events = deriveEvents(realPr, viewer, null).map((event) => {
      const seen = event.at <= lastReadAt ? { ...event, seenAt: lastReadAt } : event;
      return event.sourceId === 'rm' ? { ...seen, override: judgedQuiet } : seen;
    });
    const thread = makeThreadFor(realPr, { lastReadAt, updatedAt: realPr.updatedAt, unread: true, reason: 'author' });
    return { thread, pr: realPr, events, userState: null, viewer, notYours: false, prFetchedAt: day(30, 12) };
  }

  it('clears it: a new merge move asks nothing, and a stale nudge is no finding', () => {
    const input = caseInput(agentPr());
    expect(prWhoseTurn({ pr: input.pr, events: input.events, userState: null, viewer })).toMatchObject({ kind: 'you', move: 'merge' });
    expect(isNewYourMove(input, lastReadAt)).toBe(false);
    expect(judgedReadCheck(input)).toEqual({ kind: 'mark', actors: ['rowan', 'stale-nudge[bot]'] });
  });

  it('clears it when the merge move stood at the read: a stale nudge is no finding', () => {
    // The team request was removed before the read, so the PR was already waiting on the viewer to merge.
    const base = agentPr();
    const earlyRemoval = base.timeline.map((item) => (item.id === 'rm' ? { ...item, at: day(17) } : item));
    const input = caseInput(agentPr({ timeline: earlyRemoval }));
    expect(isNewYourMove(input, lastReadAt)).toBe(false);
    // Only bots since the read now: the bots-only rule clears it.
    expect(quietReadCheck(input)).toEqual({ kind: 'mark', bots: ['stale-nudge[bot]'] });
  });

  it('clears it after a bot reopens the approved PR: the new move is only a merge', () => {
    const closedThenReopened = agentPr({
      timeline: [
        makeTimelineItem({ id: 'rq', actor: 'acme-agent[bot]', subject: 'acme/team-infra', at: day(10) }),
        makeTimelineItem({ id: 'rm', kind: 'review_request_removed', actor: 'rowan', subject: 'acme/team-infra', at: day(12) }),
        makeTimelineItem({ id: 'cl', kind: 'closed', actor: 'stale-nudge[bot]', subject: null, at: day(16) }),
        makeTimelineItem({ id: 'ro', kind: 'reopened', actor: 'stale-nudge[bot]', subject: null, at: day(30, 9) }),
      ],
    });
    const input = caseInput(closedThenReopened);
    expect(isNewYourMove(input, lastReadAt)).toBe(false);
    expect(quietReadCheck(input).kind).toBe('mark');
  });

  it('clears it after a bot review on the own open PR: findings show up as checks and threads', () => {
    const review = makeReview({ id: 'cr', author: 'coderabbitai[bot]', state: 'COMMENTED', submittedAt: day(30, 9) });
    const base = agentPr();
    expect(judgedReadCheck(caseInput(agentPr({ reviews: [...base.reviews, review] }))).kind).toBe('mark');
  });

  it('still blocks after a re-review request: the move is new since the read', () => {
    // ada's PR: the viewer asked for changes before the read, ada pushed and asked again after it.
    const adaPr = makePr({
      number: 211,
      author: 'ada',
      reviewDecision: 'CHANGES_REQUESTED',
      reviewerUsers: [viewer.login],
      commits: [makeCommit({ oid: 'c1', author: 'ada', committedAt: day(10) }), makeCommit({ oid: 'c2', author: 'ada', committedAt: day(20) })],
      reviews: [makeReview({ id: 'mine', author: viewer.login, state: 'CHANGES_REQUESTED', submittedAt: day(15), commitOid: 'c1' })],
      timeline: [
        makeTimelineItem({ id: 'rq1', actor: 'ada', subject: viewer.login, at: day(10) }),
        makeTimelineItem({ id: 'rq2', actor: 'ada', subject: viewer.login, at: day(22) }),
      ],
      updatedAt: day(22),
    });
    const input = caseInput(adaPr);
    expect(isNewYourMove(input, lastReadAt)).toBe(true);
    expect(judgedReadCheck(input).kind).toBe('skip');
    expect(quietReadCheck(input).kind).toBe('skip');
  });
});

// The real case of 2026-10-02 (names and repo invented): a bot asked the
// viewer's home team and two other teams for a review on an outsider's PR.
// The viewer never opened the thread. The author removed the home team's
// request, then only answered review bots, and the events agent judged those
// replies quiet. The request no longer stands, so the thread clears.
describe('requestGoneReadCheck', () => {
  const day = (date: number, hour = 12) => new Date(Date.UTC(2026, 8, date, hour)).toISOString();
  const home = 'acme/team-devex';
  const devexViewer: Viewer = { login: 'viewer', teams: [home], homeTeams: [home], teamMembers: ['lyra'] };
  const judgedQuiet = { loudness: 'quiet' as const, reason: 'nothing here needs you', by: 'agent' as const };
  const request = (subject: string, id: string) => makeTimelineItem({ id, actor: 'assign-bot[bot]', subject, at: day(12) });

  function facadePr(extra: Partial<Pr> = {}): Pr {
    return makePr({
      number: 990,
      author: 'paul',
      reviewerTeams: ['acme/team-desktop', 'acme/team-data-tools'],
      timeline: [
        request(home, 'rq-devex'),
        request('acme/team-desktop', 'rq-desktop'),
        request('acme/team-data-tools', 'rq-data'),
        makeTimelineItem({ id: 'rm-devex', kind: 'review_request_removed', actor: 'assign-bot[bot]', subject: home, at: day(13) }),
      ],
      comments: [
        makeComment({ id: 'c-bot', author: 'greptile-apps[bot]', body: 'Two findings in the facade.', createdAt: day(14) }),
        makeComment({ id: 'c-paul', author: 'paul', body: 'Fixed both, thanks.', createdAt: day(15) }),
      ],
      updatedAt: day(15),
      ...extra,
    });
  }

  /** The sync: the events agent left every person's quiet activity quiet, unless `unjudged` names its source. */
  function facade(pr: Pr, options: { unjudged?: string; prFetchedAt?: string } = {}): QuietReadInput {
    const events = deriveEvents(pr, devexViewer, null).map((event) =>
      awaitsJudgement(event, pr, devexViewer) && event.sourceId !== options.unjudged ? { ...event, override: judgedQuiet } : event,
    );
    const thread = makeThreadFor(pr, { reason: 'review_requested', lastReadAt: null, updatedAt: pr.updatedAt, unread: true });
    return { thread, pr, events, userState: null, viewer: devexViewer, notYours: false, prFetchedAt: options.prFetchedAt ?? day(16) };
  }

  it('marks a never-opened thread once the request is removed and only bots and quiet replies came since', () => {
    const input = facade(facadePr());
    expect(quietReadCheck(input)).toEqual({ kind: 'skip', why: 'never_read' });
    expect(requestGoneReadCheck(input)).toEqual({ kind: 'mark', actors: ['assign-bot[bot]', 'greptile-apps[bot]', 'paul'] });
    const detail = requestGoneReadDetail(['greptile-apps[bot]', 'paul']);
    expect(detail).toBe('review request no longer stands, nothing that needs you since: greptile-apps[bot], paul');
    expect(quietReasonFromDetail(detail)).toBe('request_gone');
    expect(actorsFromQuietDetail(detail)).toEqual(['greptile-apps[bot]', 'paul']);
    // A snapshot older than the thread's update leaves it.
    expect(requestGoneReadCheck(facade(facadePr(), { prFetchedAt: day(14) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
  });

  it('leaves it while the team request is pending, or the personal one', () => {
    const teamPending = facadePr({ reviewerTeams: [home, 'acme/team-desktop'], timeline: [request(home, 'rq-devex')] });
    expect(requestGoneReadCheck(facade(teamPending))).toEqual({ kind: 'skip', why: 'request_stands' });
    const personal = facadePr({ reviewerUsers: [devexViewer.login], timeline: [...facadePr().timeline, request(devexViewer.login, 'rq-me')] });
    expect(requestGoneReadCheck(facade(personal))).toEqual({ kind: 'skip', why: 'request_stands' });
  });

  it("marks it once a teammate's review answered the team request", () => {
    const answered = facadePr({
      reviewerTeams: [home],
      timeline: [request(home, 'rq-devex')],
      reviews: [makeReview({ id: 'r-lyra', author: 'lyra', state: 'APPROVED', submittedAt: day(14) })],
    });
    expect(requestGoneReadCheck(facade(answered))).toEqual({ kind: 'mark', actors: ['greptile-apps[bot]', 'lyra', 'paul'] });
  });

  it("leaves it when the team was asked again after a teammate's older review", () => {
    const asked = (reviewAt: string, askedAgainAt: string) =>
      facadePr({
        reviewerTeams: [home],
        timeline: [request(home, 'rq-devex'), makeTimelineItem({ id: 'rq-again', actor: 'assign-bot[bot]', subject: home, at: askedAgainAt })],
        reviews: [makeReview({ id: 'r-lyra', author: 'lyra', state: 'APPROVED', submittedAt: reviewAt })],
      });
    expect(requestGoneReadCheck(facade(asked(day(13), day(14, 6))))).toEqual({ kind: 'skip', why: 'request_stands' });
    expect(requestGoneReadCheck(facade(asked(day(14, 13), day(13))))).toEqual({ kind: 'mark', actors: ['greptile-apps[bot]', 'lyra', 'paul'] });
  });

  it('leaves it for a person the events agent has not judged quiet', () => {
    expect(requestGoneReadCheck(facade(facadePr(), { unjudged: 'c-paul' }))).toEqual({ kind: 'skip', why: 'not_judged' });
  });

  it('leaves other never-read threads alone, a mention among them', () => {
    const input = facade(facadePr());
    const mention = { ...input.thread, reason: 'mention' as const };
    expect(requestGoneReadCheck({ ...input, thread: mention })).toEqual({ kind: 'skip', why: 'not_requested' });
    expect(requestGoneReadCheck({ ...input, thread: { ...input.thread, lastReadAt: day(12, 13) } })).toEqual({ kind: 'skip', why: 'was_read' });
  });
});
