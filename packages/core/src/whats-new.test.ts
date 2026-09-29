import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, viewer } from './fixtures.ts';
import type { PrEvent } from './types.ts';
import { whatsNew } from './whats-new.ts';

const me = viewer.login;
/** alice's PR, reviewed by the viewer. */
const pr = makePr();

let seq = 0;
function ev(overrides: Partial<PrEvent>): PrEvent {
  seq += 1;
  return makeEvent({ id: `e${seq}`, sourceId: `s${seq}`, ...overrides });
}

/** One of the viewer's own events: quiet by the rules ("your own activity"). */
function own(kind: PrEvent['kind'], minutes: number): PrEvent {
  return ev({ kind, actor: me, at: at(minutes), ruleLoudness: 'quiet', ruleReason: 'your own activity', seenAt: at(minutes) });
}

function loud(kind: PrEvent['kind'], actor: string, minutes: number, summary = `${actor} did ${kind}`): PrEvent {
  return ev({ kind, actor, at: at(minutes), ruleLoudness: 'loud', ruleReason: 'addressed your changes', summary });
}

describe('whatsNew', () => {
  it('is null without new loud events', () => {
    expect(whatsNew(pr, [own('review_changes_requested', 0)], viewer)).toBeNull();
    expect(whatsNew(pr, [], viewer)).toBeNull();
  });

  it('is null for a first-time ask (no touch before the new events)', () => {
    const request = loud('review_requested', 'rowan', 10);
    expect(whatsNew(pr, [request], viewer)).toBeNull();
  });

  it('is null without a viewer', () => {
    expect(whatsNew(pr, [own('review_changes_requested', 0), loud('commits_pushed', 'pim', 5)], null)).toBeNull();
  });

  it('counts pushes after the viewer asked for changes: "6 commits since your changes request"', () => {
    const pushes = [1, 2, 3, 4, 5, 6].map((n) => loud('commits_pushed', 'pim', 60 + n));
    const result = whatsNew(pr, [own('review_changes_requested', 0), ...pushes], viewer);
    expect(result).toEqual({
      anchor: { kind: 'changes_request', at: at(0) },
      lead: { kind: 'push', eventKind: 'commits_pushed', actor: 'pim', count: 6, summary: 'pim did commits_pushed' },
      extraCount: 0,
      actor: 'pim',
      newestAt: at(66),
    });
  });

  it('leads with a reply over pushes, and counts the pushes as one more', () => {
    const events = [own('review_commented', 0), loud('commits_pushed', 'pim', 5), loud('commits_pushed', 'pim', 6), loud('reply_to_user', 'lyra', 7)];
    const result = whatsNew(pr, events, viewer);
    expect(result?.anchor.kind).toBe('review');
    expect(result?.lead).toMatchObject({ kind: 'reply', actor: 'lyra', count: 1 });
    expect(result?.extraCount).toBe(1);
    expect(result?.actor).toBe('lyra');
    expect(result?.newestAt).toBe(at(7));
  });

  it('ranks a changes request by someone else over pushes', () => {
    const events = [own('review_approved', 0), loud('commits_after_approval', 'rowan', 5), loud('review_changes_requested', 'lyra', 6)];
    const result = whatsNew(pr, events, viewer);
    expect(result?.anchor.kind).toBe('approval');
    expect(result?.lead).toMatchObject({ kind: 'changes_requested', actor: 'lyra' });
    expect(result?.extraCount).toBe(1);
  });

  it('ranks a mention above everything else, the newest on a tie', () => {
    const events = [own('comment', 0), loud('review_approved', 'ada', 3), loud('mention', 'lyra', 4), loud('mention', 'sol', 5)];
    const result = whatsNew(pr, events, viewer);
    expect(result?.anchor.kind).toBe('comment');
    expect(result?.lead).toMatchObject({ kind: 'mention', actor: 'sol' });
    expect(result?.extraCount).toBe(2);
  });

  it('takes the newest own action before the new events as the anchor', () => {
    const events = [own('review_changes_requested', 0), own('comment', 30), loud('commits_pushed', 'pim', 40)];
    expect(whatsNew(pr, events, viewer)?.anchor).toEqual({ kind: 'comment', at: at(30) });
  });

  it('ignores own events that are not a touch (a review request) and after the new events', () => {
    const events = [own('review_requested', 0), loud('mention', 'lyra', 5), own('comment', 9)];
    expect(whatsNew(pr, events, viewer)).toBeNull();
  });

  it('anchors on a merge or close the viewer did themselves', () => {
    expect(whatsNew(pr, [own('merged', 0), loud('mention', 'lyra', 5)], viewer)?.anchor).toEqual({ kind: 'merge', at: at(0) });
    expect(whatsNew(pr, [own('closed', 0), loud('mention', 'lyra', 5)], viewer)?.anchor).toEqual({ kind: 'close', at: at(0) });
  });

  it('anchors on a push only on the viewer own PR', () => {
    const events = [own('commits_pushed', 0), loud('review_changes_requested', 'lyra', 5)];
    expect(whatsNew(pr, events, viewer)).toBeNull();
    expect(whatsNew(makePr({ author: me }), events, viewer)?.anchor).toEqual({ kind: 'push', at: at(0) });
  });

  it('falls back to the mark-read when the viewer never acted', () => {
    const readRequest = ev({ kind: 'review_requested', actor: 'rowan', at: at(0), ruleLoudness: 'loud', seenAt: at(20) });
    const mention = loud('mention', 'lyra', 30);
    const result = whatsNew(pr, [readRequest, mention], viewer);
    expect(result?.anchor).toEqual({ kind: 'read', at: at(20) });
    expect(result?.lead).toMatchObject({ kind: 'mention', actor: 'lyra' });
  });

  it('prefers the viewer\'s own action over a later mark-read', () => {
    const events = [own('review_changes_requested', 0), ev({ kind: 'ci', actor: '', isBot: true, at: at(5), seenAt: at(10) }), loud('commits_pushed', 'pim', 20)];
    expect(whatsNew(pr, events, viewer)?.anchor.kind).toBe('changes_request');
  });

  it('never counts quiet bot and CI events', () => {
    const bot = ev({ kind: 'bot_comment', actor: 'greptile[bot]', isBot: true, at: at(8), ruleLoudness: 'quiet' });
    const ci = ev({ kind: 'ci', actor: '', isBot: true, at: at(9), ruleLoudness: 'quiet' });
    const events = [own('review_changes_requested', 0), loud('commits_pushed', 'pim', 5), bot, ci];
    const result = whatsNew(pr, events, viewer);
    expect(result?.lead.count).toBe(1);
    expect(result?.extraCount).toBe(0);
    expect(result?.newestAt).toBe(at(5));
  });

  it('counts a push the agent raised after an approval', () => {
    const raised = ev({
      kind: 'commits_after_approval',
      actor: 'rowan',
      at: at(10),
      ruleLoudness: 'quiet',
      override: { loudness: 'loud', reason: 'changes the runner image', by: 'agent' },
    });
    const plain = ev({ kind: 'commits_after_approval', actor: 'rowan', at: at(9), ruleLoudness: 'quiet' });
    const result = whatsNew(pr, [own('review_approved', 0), plain, raised], viewer);
    expect(result?.anchor.kind).toBe('approval');
    expect(result?.lead).toMatchObject({ kind: 'push', count: 1, actor: 'rowan' });
  });

  it('says other kinds by their summary', () => {
    const events = [own('review_commented', 0), loud('ready_for_review', 'pim', 5, 'pim marked it ready for review')];
    expect(whatsNew(pr, events, viewer)?.lead).toMatchObject({ kind: 'other', summary: 'pim marked it ready for review' });
  });

  it('matches the viewer case-insensitively', () => {
    const mine = ev({ kind: 'review_changes_requested', actor: me.toUpperCase(), at: at(0) });
    expect(whatsNew(pr, [mine, loud('commits_pushed', 'pim', 5)], viewer)?.anchor.kind).toBe('changes_request');
  });
});
