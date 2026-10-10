// The rules checks of rules-invariants.test.ts, run over the default sample
// plus each opt-in pack (POSTPILE_FAKE_EXTRA). Pack-specific placement tests
// stay in sample-packs.test.ts and fake-extras.test.ts.
import type { PaneOffers, PrSummary, TileView } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';
import type { FakeExtra } from './fake-extras.ts';

const NOW = new Date('2026-09-29T12:00:00Z');

const PACKS: FakeExtra[] = ['board', 'stacks', 'pane', 'stress', 'calm', 'mcp'];

function engineWith(pack: FakeExtra): FakeEngine {
  return new FakeEngine({ now: () => NOW, extras: new Set([pack]) });
}

/** Every tile of every topic, active and finished. */
async function allTiles(engine: FakeEngine): Promise<TileView[]> {
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

describe.each(PACKS)('pack %s: rules agree', (pack) => {
  it('a done tile offers only Open', async () => {
    for (const view of await allTiles(engineWith(pack))) {
      if (view.state.kind !== 'done') {
        continue;
      }
      expect(view.offers, view.tile.id).toMatchObject({ footer: 'open', markLabel: null, github: null });
      for (const pr of view.prs) {
        expect(paneOf(view, pr), pr.key).toMatchObject({ lead: 'none', approve: false, ask: false, markLabel: null, snooze: false, removeTeams: [] });
      }
    }
  });

  it('a done PR offers only Open, or Mark read while its news is unseen or its thread unread', async () => {
    for (const view of await allTiles(engineWith(pack))) {
      for (const pr of view.prs.filter((row) => row.done)) {
        const pane = paneOf(view, pr);
        if (pr.unseenLoudEvents > 0 || pr.unreadOnGitHub) {
          expect(pane, pr.key).toMatchObject({ approve: false, ask: false, removeTeams: [] });
          expect(pane.markLabel, pr.key).not.toBeNull();
        } else {
          expect(pane, pr.key).toMatchObject({ lead: 'none', approve: false, ask: false, markLabel: null, removeTeams: [] });
        }
      }
    }
  });

  it('the lead PR is the PR of the tile turn, and the tile turn is the turn of one of its PRs', async () => {
    for (const view of await allTiles(engineWith(pack))) {
      if (view.turn.kind === 'none' || view.turn.prKey === null) {
        continue;
      }
      const row = view.prs.find((pr) => pr.key === view.turn.prKey);
      expect(view.offers.leadPrKey, view.tile.id).toBe(view.turn.prKey);
      // A stack's blocked merge names the holding layer, whose own row waits on the same person.
      expect(row?.turn.kind, view.tile.id).toBe(view.turn.kind);
    }
  });

  it('tier To review and whose move Review agree', async () => {
    for (const view of await allTiles(engineWith(pack))) {
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

  it('groups every tile once and counts the Unread group, per topic', async () => {
    const engine = engineWith(pack);
    for (const item of await engine.listTopics()) {
      const tiles = (await engine.getTopic(item.topic.id))?.tiles ?? [];
      for (const view of tiles) {
        const expected = view.unreadPrKeys.length > 0 ? 'unread' : view.state.kind === 'done' ? 'dealt_with' : 'open';
        expect(view.group, view.tile.id).toBe(expected);
      }
      expect(item.unreadTiles, item.topic.id).toBe(tiles.filter((view) => view.group === 'unread').length);
    }
  });

  it('gives every tile member a PR', async () => {
    for (const view of await allTiles(engineWith(pack))) {
      expect(view.prs.length, view.tile.id).toBe(view.tile.members.length);
    }
  });

  it('every stack is complete: one open layer at least, layers in tile order, branches chained bottom first unless declared', async () => {
    const engine = engineWith(pack);
    for (const view of await allTiles(engine)) {
      for (const stack of view.tile.stacks) {
        const layers = stack.prKeys.map((key) => view.prs.find((pr) => pr.key === key));
        expect(layers.every((layer) => layer !== undefined), stack.id).toBe(true);
        expect(layers.some((layer) => layer?.state === 'OPEN'), stack.id).toBe(true);
        if (view.tile.kind === 'stack') {
          expect(stack.prKeys, stack.id).toEqual(view.tile.members.map((member) => member.prKey));
        }
        const prs = await Promise.all(stack.prKeys.map((key) => engine.getPr(key)));
        for (let index = 1; index < prs.length; index += 1) {
          // A layer its body declares (`declaredLinks`) is a stack without chained branches.
          if (stack.declaredLinks?.includes(stack.prKeys[index]!)) {
            continue;
          }
          expect(prs[index]?.pr.baseRef, `${stack.id} layer ${index + 1}`).toBe(prs[index - 1]?.pr.headRef);
        }
      }
    }
  });
});
