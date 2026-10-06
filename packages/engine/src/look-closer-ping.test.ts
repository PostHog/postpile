import type { Glance, FullPr } from '@postpile/core';
import { at, makePr, makeReview, makeThreadFor, makeTimelineItem } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { GlancePings, lookCloserMetaKey } from './live/glance-pings.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { topicWithPrs } from './testing/topics.ts';

const TEAM = 'acme/team-platform';

/** rowan's PR from outside the team; a reviewer-assigning bot routed the review to the viewer's team. */
function routedPr(overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number: 31,
    author: 'rowan',
    reviewerTeams: [TEAM],
    timeline: [makeTimelineItem({ id: 'rr-1', actor: 'assignbot[bot]', subject: TEAM, at: at(1) })],
    updatedAt: at(2),
    ...overrides,
  });
}

function glance(pr: FullPr, verdict: Glance['verdict'], forYou = 'The cache key change touches the runner image. Check the salt.'): Glance {
  return {
    prKey: pr.key,
    verdict,
    forYou,
    does: '',
    risk: '',
    othersSaid: '',
    keyFiles: [],
    pullInReason: null,
    dossierVersion: null,
    inputHash: `h-${verdict}`,
    model: 'fake',
    createdAt: at(3),
  };
}

async function synced(pr: FullPr): Promise<{ h: Harness; pings: GlancePings }> {
  const h = makeHarness();
  topicWithPrs(h, 'depot', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  // Everything read: only the glance ping can make the tile unread now.
  h.store.events.markSeen(h.store.events.listForPr(pr.key).map((event) => event.id), at(2));
  return { h, pings: new GlancePings(h.store, () => new Date('2026-09-02T12:00:00Z')) };
}

function written(h: Harness, pings: GlancePings, g: Glance): void {
  h.store.glances.put(g);
  pings.afterGlances([g.prKey]);
}

async function tileState(h: Harness): Promise<string | undefined> {
  return (await h.engine.getTopic('depot'))?.tiles[0]?.state.kind;
}

function glanceDecisions(h: Harness) {
  return h.store.pingDecisions.listRecent(20).filter((decision) => decision.source === 'glance');
}

describe('routed team requests ping when the glance says Look closer', () => {
  it('pings once, records the decision and marks the tile unread with the reason', async () => {
    const pr = routedPr();
    const { h, pings } = await synced(pr);
    // The routed request's thread is unread on GitHub: unread, but without loud news.
    expect((await h.engine.getTopic('depot'))?.tiles[0]?.state).toMatchObject({ kind: 'unread', loud: false });

    written(h, pings, glance(pr, 'LOOK_CLOSER'));

    const sent = pings.drain();
    expect(sent).toEqual([
      {
        title: 'Look closer: review for team-platform · app#31',
        body: `${pr.title}\nThe cache key change touches the runner image.`,
        target: { topicId: 'depot', tileId: `pr:${pr.key}`, prKey: pr.key },
        personal: false,
      },
    ]);
    expect(pings.drain()).toEqual([]);
    expect(glanceDecisions(h)).toEqual([expect.objectContaining({ ping: true, reason: 'Look closer: review routed to team-platform', prKey: pr.key })]);
    const view = (await h.engine.getTopic('depot'))?.tiles[0];
    expect(view?.state).toMatchObject({ kind: 'unread', loud: true });
    expect(view?.state.unreadBecause.map((reason) => reason.summary)).toEqual(['Look closer: review routed to team-platform']);
  });

  it('does not ping again when the glance is rewritten for the same request', async () => {
    const pr = routedPr();
    const { h, pings } = await synced(pr);
    written(h, pings, glance(pr, 'LOOK_CLOSER'));
    pings.drain();

    written(h, pings, { ...glance(pr, 'LOOK_CLOSER', 'Still worth a look.'), inputHash: 'h-2' });

    expect(pings.drain()).toEqual([]);
    expect(glanceDecisions(h)).toHaveLength(1);
  });

  it('pings again for a new request after a removal', async () => {
    const pr = routedPr();
    const { h, pings } = await synced(pr);
    written(h, pings, glance(pr, 'LOOK_CLOSER'));
    pings.drain();
    const again = routedPr({
      timeline: [
        makeTimelineItem({ id: 'rr-1', actor: 'assignbot[bot]', subject: TEAM, at: at(1) }),
        makeTimelineItem({ id: 'rm-1', kind: 'review_request_removed', actor: 'rowan', subject: TEAM, at: at(4) }),
        makeTimelineItem({ id: 'rr-2', actor: 'rowan', subject: TEAM, at: at(5) }),
      ],
    });
    h.store.prs.upsert(again, at(6));

    pings.afterGlances([pr.key]);

    expect(pings.drain()).toHaveLength(1);
    expect(h.store.meta.get(lookCloserMetaKey(pr.key))).toBe('rr-2');
  });

  it('never pings for Looks safe or Not yours', async () => {
    const pr = routedPr();
    const { h, pings } = await synced(pr);
    written(h, pings, glance(pr, 'LOOKS_SAFE'));
    written(h, pings, glance(pr, 'NOT_YOURS'));
    expect(pings.drain()).toEqual([]);
    expect(glanceDecisions(h)).toEqual([]);
  });

  it('pings even when a teammate reviewed already, and a mark-read clears the unread tile', async () => {
    const pr = routedPr({ reviews: [makeReview({ author: 'lyra', state: 'COMMENTED', submittedAt: at(2) })] });
    const { h, pings } = await synced(pr);

    written(h, pings, glance(pr, 'LOOK_CLOSER'));

    expect(pings.drain()).toHaveLength(1);
    expect(await tileState(h)).toBe('unread');
    await h.engine.markRead(`pr:${pr.key}`);
    expect(await tileState(h)).not.toBe('unread');
  });

  it('keeps the unread marker when the PR snapshot is stored again', async () => {
    const pr = routedPr();
    const { h, pings } = await synced(pr);
    written(h, pings, glance(pr, 'LOOK_CLOSER'));
    h.reader.addPr({ ...pr, updatedAt: at(8) }, makeThreadFor(pr, { updatedAt: at(8) }));
    h.reader.etag = 'etag-2';

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.events.listForPr(pr.key).some((event) => event.kind === 'look_closer' && event.seenAt === null)).toBe(true);
  });

  it('never pings while the tile is snoozed, after the viewer reviewed, or for a teammate PR', async () => {
    const snoozedPr = routedPr();
    const snoozed = await synced(snoozedPr);
    await snoozed.h.engine.snooze(`pr:${snoozedPr.key}`, { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' });
    written(snoozed.h, snoozed.pings, glance(snoozedPr, 'LOOK_CLOSER'));
    expect(snoozed.pings.drain()).toEqual([]);

    const reviewedPr = routedPr({ reviews: [makeReview({ author: 'viewer', state: 'COMMENTED', commitOid: 'head', submittedAt: at(2) })] });
    const reviewed = await synced(reviewedPr);
    written(reviewed.h, reviewed.pings, glance(reviewedPr, 'LOOK_CLOSER'));
    expect(reviewed.pings.drain()).toEqual([]);

    const ownPr = routedPr({ author: 'viewer' });
    const own = await synced(ownPr);
    written(own.h, own.pings, glance(ownPr, 'LOOK_CLOSER'));
    expect(own.pings.drain()).toEqual([]);
  });

  it('reaches the Mac through the next poll cycle', async () => {
    const pr = routedPr();
    const h = makeHarness();
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerGlances((input) => {
      const all = h.agent.allGlances(input);
      return { ...all, glances: all.glances.map((g) => ({ ...g, verdict: 'LOOK_CLOSER' as const })) };
    });
    await h.engine.sync({ agentJobs: ['glances'] });

    const cycle = await h.engine.pollOnce();

    expect(cycle.kind === 'done' ? cycle.pings.map((ping) => ping.target.prKey) : []).toEqual([pr.key]);
  });
});
