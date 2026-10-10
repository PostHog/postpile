// Invariants across rules over the sample boards (DESIGN.md "Rules layer:
// one home per fact", "Tests across rules"). Each rule has its own tests;
// these check that the rules agree with each other on every sample tile.
import type { PaneOffers, PrSummary, TileView, TopicSection } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const NOW = new Date('2026-09-29T12:00:00Z');

/** Every tile of every sample topic, active and finished. */
async function sampleTiles(engine: FakeEngine): Promise<TileView[]> {
  const ids = [...(await engine.listTopics()).map((item) => item.topic.id), ...(await engine.listFinishedTopics()).map((topic) => topic.id)];
  const views: TileView[] = [];
  for (const id of new Set(ids)) {
    views.push(...((await engine.getTopic(id))?.tiles ?? []));
  }
  return views;
}

function paneOf(view: TileView, pr: PrSummary): PaneOffers {
  const pane = view.offers.pane[pr.key];
  if (!pane) {
    throw new Error(`no pane offers for ${pr.key} on ${view.tile.id}`);
  }
  return pane;
}

/**
 * A done PR or tile offers only Open on GitHub, and never Ask, Snooze or
 * Remove team; Approve only as the outlined "Approve again" on an open PR
 * the viewer approved (2026-10-10).
 */
function expectOnlyOpen(pane: PaneOffers, pr: PrSummary): void {
  expect(pane, pr.key).toMatchObject({ lead: 'none', approve: pr.primaryAction === 'approved', ask: false, markLabel: null, snooze: false, removeTeams: [] });
}

describe('quiet rows on the sample board', () => {
  it('dims some rows and not others', async () => {
    const topics = await new FakeEngine({ now: () => NOW }).listTopics();
    expect(topics.some((item) => item.quiet)).toBe(true);
    expect(topics.some((item) => !item.quiet)).toBe(true);
  });

  it('has an owner section with dealt-with topics behind its line and one that is all dealt with', async () => {
    const topics = await new FakeEngine({ now: () => NOW }).listTopics();
    const quietIn = (section: TopicSection) => topics.filter((item) => item.section === section).map((item) => item.quiet);
    // Other work lists a topic with news and hides the rest; every Your team owns topic is dealt with.
    expect(quietIn('other_work')).toContain(true);
    expect(quietIn('other_work')).toContain(false);
    expect(quietIn('team_owns').length).toBeGreaterThan(0);
    expect(quietIn('team_owns').every(Boolean)).toBe(true);
  });
});

describe('rules agree on the sample boards', () => {
  // A done PR on a live tile is not in the sample; packages/core/src/rules-invariants.test.ts covers it.
  it('has done tiles, sets and your moves to check', async () => {
    const views = await sampleTiles(new FakeEngine({ now: () => NOW }));
    expect(views.some((view) => view.state.kind === 'done')).toBe(true);
    expect(views.some((view) => view.tile.members.length > 1)).toBe(true);
    expect(views.some((view) => view.turn.kind === 'you')).toBe(true);
  });

  it('a done tile offers only Open', async () => {
    for (const view of await sampleTiles(new FakeEngine({ now: () => NOW }))) {
      if (view.state.kind !== 'done') {
        continue;
      }
      expect(view.offers, view.tile.id).toMatchObject({ footer: 'open', markLabel: null, github: null });
      for (const pr of view.prs) {
        expectOnlyOpen(paneOf(view, pr), pr);
      }
    }
  });

  it('a done PR offers only Open, or Mark read while its own news is unseen or its thread unread on GitHub', async () => {
    for (const view of await sampleTiles(new FakeEngine({ now: () => NOW }))) {
      for (const pr of view.prs.filter((row) => row.done)) {
        const pane = paneOf(view, pr);
        if (pr.unseenLoudEvents > 0 || pr.unreadOnGitHub) {
          expect(pane, pr.key).toMatchObject({ approve: pr.primaryAction === 'approved', ask: false, removeTeams: [] });
          expect(pane.markLabel, pr.key).not.toBeNull();
        } else {
          expect(pane, pr.key).toMatchObject({ lead: 'none', approve: pr.primaryAction === 'approved', ask: false, markLabel: null, removeTeams: [] });
        }
      }
    }
  });

  it('the lead PR is the PR of the tile turn', async () => {
    for (const view of await sampleTiles(new FakeEngine({ now: () => NOW }))) {
      const inTile = view.prs.some((pr) => pr.key === view.turn.prKey);
      if (view.turn.kind !== 'none' && inTile) {
        expect(view.offers.leadPrKey, view.tile.id).toBe(view.turn.prKey);
      }
    }
  });

  it('the tile turn is the turn of one of its PRs', async () => {
    for (const view of await sampleTiles(new FakeEngine({ now: () => NOW }))) {
      if (view.turn.kind === 'none' || view.turn.prKey === null) {
        continue;
      }
      const row = view.prs.find((pr) => pr.key === view.turn.prKey);
      // A pulled-in stack layer can carry the move of its stack; its own row then says the same kind.
      expect(row?.turn.kind, view.tile.id).toBe(view.turn.kind);
    }
  });

  it('gives the same facts for the same events', async () => {
    const first = await sampleTiles(new FakeEngine({ now: () => NOW }));
    const second = await sampleTiles(new FakeEngine({ now: () => NOW }));
    const factsOf = (views: TileView[]) =>
      views.map((view) => ({
        tile: view.tile.id,
        state: view.state,
        turn: view.turn,
        offers: view.offers,
        prs: view.prs.map((pr) => ({ key: pr.key, facts: pr.facts, turn: pr.turn, done: pr.done, tier: pr.tier, afterRead: pr.afterRead })),
      }));
    expect(factsOf(second)).toEqual(factsOf(first));
  });

  // Tier and whose move are separate rules. They agree except where they
  // differ on purpose: a team request routed to someone else (the agent's
  // NOT_YOURS, changes held by another reviewer, a teammate already on it)
  // stays in To review for the team while it is nobody's move or theirs,
  // and a team mention on a PR you are asked to review is a reply first.
  it('tier To review and whose move Review agree', async () => {
    for (const view of await sampleTiles(new FakeEngine({ now: () => NOW }))) {
      for (const pr of view.prs.filter((row) => row.state === 'OPEN')) {
        const review = pr.turn.kind === 'you' && pr.turn.move === 'review';
        if (review) {
          expect(pr.tier, pr.key).toBe('to_review');
        }
        if (pr.tier === 'to_review' && !review) {
          const routed = pr.facts.reviewRequest === 'team' || pr.facts.reviewRequest === 'team_taken';
          const teamReply = pr.turn.kind === 'you' && pr.turn.move === 'reply';
          expect(routed || teamReply, `${pr.key}: tier to_review, move ${pr.turn.kind}`).toBe(true);
        }
      }
    }
  });

  // DESIGN.md "Groups inside a topic": the sample tiles land in the groups
  // core gives them, and the sidebar counts and the footer total (the counts
  // added up) are the tiles in the Unread group.
  it('groups every tile once and counts the Unread group, per topic and in total', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const items = await engine.listTopics();
    let total = 0;
    for (const item of items) {
      const tiles = (await engine.getTopic(item.topic.id))?.tiles ?? [];
      for (const view of tiles) {
        const expected = view.unreadPrKeys.length > 0 ? 'unread' : view.state.kind === 'done' ? 'dealt_with' : 'open';
        expect(view.group, view.tile.id).toBe(expected);
      }
      const unread = tiles.filter((view) => view.group === 'unread').length;
      expect(item.unreadTiles, item.topic.id).toBe(unread);
      total += unread;
    }
    expect(items.reduce((sum, item) => sum + item.unreadTiles, 0)).toBe(total);
    const views = await sampleTiles(engine);
    expect(new Set(views.map((view) => view.group))).toEqual(new Set(['unread', 'open', 'dealt_with']));
  });
});
