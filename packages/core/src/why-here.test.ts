import { describe, expect, it } from 'vitest';
import { makePr, makeTimelineItem, viewer } from './fixtures.ts';
import type { Provenance } from './types.ts';
import { tileWhy, whyHere } from './why-here.ts';

function pinged(reason: Extract<Provenance, { kind: 'pinged' }>['reason']): Provenance {
  return { kind: 'pinged', reason };
}

describe('whyHere', () => {
  it('marks pulled-in stack layers as ST', () => {
    expect(whyHere({ kind: 'pulled_in', reason: 'stack layer below #2' }, makePr(), viewer)).toBe('ST');
  });

  it('tells a personal review request from a team one', () => {
    const personal = makePr({ reviewerUsers: [viewer.login], reviewerTeams: ['acme/team-platform'] });
    const team = makePr({ reviewerTeams: ['acme/team-platform'] });
    const bareSlug = makePr({ reviewerTeams: ['team-platform'] });
    expect(whyHere(pinged('review_requested'), personal, viewer)).toBe('RV');
    expect(whyHere(pinged('review_requested'), team, viewer)).toBe('RT');
    expect(whyHere(pinged('review_requested'), bareSlug, viewer)).toBe('RT');
  });

  it('falls back to the timeline once the request is answered, newest request first', () => {
    const pr = makePr({
      timeline: [
        makeTimelineItem({ id: 't1', subject: viewer.login }),
        makeTimelineItem({ id: 't2', subject: 'acme/team-platform' }),
      ],
    });
    expect(whyHere(pinged('review_requested'), pr, viewer)).toBe('RT');
  });

  it('guesses RV when nothing says who was asked', () => {
    expect(whyHere(pinged('review_requested'), makePr(), viewer)).toBe('RV');
    expect(whyHere(pinged('review_requested'), null, null)).toBe('RV');
  });

  it('maps the other reasons', () => {
    const pr = makePr();
    expect(whyHere(pinged('mention'), pr, viewer)).toBe('@');
    expect(whyHere(pinged('team_mention'), pr, viewer)).toBe('@T');
    expect(whyHere(pinged('assign'), pr, viewer)).toBe('AS');
    expect(whyHere(pinged('author'), pr, viewer)).toBe('AU');
    expect(whyHere(pinged('comment'), pr, viewer)).toBe('CM');
    expect(whyHere(pinged('subscribed'), pr, viewer)).toBe('FW');
    expect(whyHere(pinged('ci_activity'), pr, viewer)).toBe('FW');
  });

  it('says AU for passive reasons on the viewer’s own PR', () => {
    const own = makePr({ author: viewer.login });
    expect(whyHere(pinged('comment'), own, viewer)).toBe('AU');
    expect(whyHere(pinged('subscribed'), own, viewer)).toBe('AU');
  });
});

describe('tileWhy', () => {
  it('picks the most aimed code', () => {
    expect(tileWhy(['FW', 'RT', 'ST'])).toBe('RT');
    expect(tileWhy(['RT', '@'])).toBe('@');
    expect(tileWhy(['AU', 'CM'])).toBe('AU');
    expect(tileWhy([])).toBe('ST');
  });
});
