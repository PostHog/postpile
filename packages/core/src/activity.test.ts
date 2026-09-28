import { describe, expect, it } from 'vitest';
import { activityList, noiseLabel } from './activity.ts';
import { reviewRequestSubject } from './events.ts';
import { at, makeEvent, viewer } from './fixtures.ts';
import type { EventDisplayState, PrEvent } from './types.ts';
import type { EventView } from './views.ts';

const me = viewer.login;
const team = viewer.teams[0] ?? 'PostHog/team-devex';
const who = { ...viewer, teams: [team] };

let seq = 0;
function ev(overrides: Partial<PrEvent>, display: EventDisplayState = 'seen'): EventView {
  seq += 1;
  return { event: makeEvent({ id: `e${seq}`, sourceId: `s${seq}`, ...overrides }), display };
}

describe('activityList', () => {
  it('keeps human talk and lifecycle, folds bots and CI into noise', () => {
    const comment = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(1) });
    const review = ev({ kind: 'review_approved', actor: 'ada', summary: 'ada approved', at: at(2) });
    const ci = ev({ kind: 'ci', actor: '', isBot: true, summary: 'CI passed', at: at(3) });
    const bot = ev({ kind: 'bot_comment', actor: 'greptile-apps[bot]', isBot: true, summary: 'greptile commented', at: at(4) });
    const merged = ev({ kind: 'merged', actor: 'ada', summary: 'ada merged', at: at(5) });
    const list = activityList([comment, review, ci, bot, merged], who);
    expect(list.earlier.map((line) => line.summary)).toEqual(['ada merged', 'ada approved', 'lyra commented']);
    expect(list.noise.map((view) => view.event.summary)).toEqual(['greptile commented', 'CI passed']);
    expect(list.fresh).toEqual([]);
  });

  it('keeps review requests naming you or your team, drops the ones between others', () => {
    const forMe = ev({ kind: 'review_requested', actor: 'rowan', summary: `rowan requested a review from ${me}`, at: at(1) });
    const forTeam = ev({ kind: 'review_requested', actor: 'rowan', summary: `rowan requested a review from ${team}`, at: at(2) });
    const forSam = ev({ kind: 'review_requested', actor: 'rowan', summary: 'rowan requested a review from sol', at: at(3) });
    const list = activityList([forMe, forTeam, forSam], who);
    expect(list.earlier.map((line) => line.id)).toEqual([forTeam.event.id, forMe.event.id]);
    expect(list.noise.map((view) => view.event.id)).toEqual([forSam.event.id]);
    expect(noiseLabel(list.noise)).toBe('1 bot/CI and other event');
  });

  it('collapses a burst of pushes by one person into one line', () => {
    const pushes = [1, 2, 3].map((minute) => ev({ kind: 'commits_pushed', actor: 'rowan', summary: `rowan pushed: c${minute}`, at: at(minute) }));
    const comment = ev({ kind: 'comment', actor: 'lyra', summary: 'lyra commented', at: at(4) });
    const later = ev({ kind: 'commits_after_approval', actor: 'rowan', summary: 'rowan pushed: fix', at: at(5) }, 'loud');
    const list = activityList([...pushes, comment, later], who);
    expect(list.fresh.map((line) => line.summary)).toEqual(['rowan pushed: fix']);
    expect(list.earlier.map((line) => line.summary)).toEqual(['lyra commented', 'rowan pushed 3 commits']);
    expect(list.earlier[1]?.events).toHaveLength(3);
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

  it('labels machine-only noise as bot/CI events', () => {
    const ci = ev({ kind: 'ci', actor: '', isBot: true, summary: 'CI passed' });
    const deploy = ev({ kind: 'deploy', actor: 'vercel', isBot: true, summary: 'vercel deploy' });
    expect(noiseLabel([ci, deploy])).toBe('2 bot/CI events');
  });
});

describe('reviewRequestSubject', () => {
  it('reads the requested login or team back from the summary', () => {
    expect(reviewRequestSubject('rowan requested a review from PostHog/team-devex')).toBe('PostHog/team-devex');
    expect(reviewRequestSubject('rowan removed the review request for sol')).toBe('sol');
    expect(reviewRequestSubject('rowan commented')).toBeNull();
  });
});
