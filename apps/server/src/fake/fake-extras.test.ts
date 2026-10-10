// The opt-in sample packs: where each pack puts its PRs and the shapes it is
// there to show. The rules checks over every pack live in pack-invariants.test.ts.
import { DOSSIER_LIMITS, type TileView, type TopicListItem } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';
import { fakeExtras, type FakeExtra } from './fake-extras.ts';
import { BOARD_TOPIC } from './sample-pack-board.ts';
import { CALM_TOPIC } from './sample-pack-calm.ts';
import { STRESS_BIG_NUMBER, STRESS_LONG_TITLE, STRESS_TOPIC, STRESS_TOPIC_NAME } from './sample-pack-stress.ts';

const NOW = new Date('2026-09-29T12:00:00Z');

function engineWith(...extras: FakeExtra[]): FakeEngine {
  return new FakeEngine({ now: () => NOW, extras: new Set(extras) });
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

async function tileOf(engine: FakeEngine, number: number): Promise<TileView> {
  const view = (await allTiles(engine)).find((candidate) => candidate.prs.some((pr) => pr.key.endsWith(`#${number}`)));
  if (!view) {
    throw new Error(`no tile holds #${number}`);
  }
  return view;
}

async function topicItem(engine: FakeEngine, topicId: string): Promise<TopicListItem> {
  const item = (await engine.listTopics()).find((candidate) => candidate.topic.id === topicId);
  if (!item) {
    throw new Error(`no topic ${topicId} in the list`);
  }
  return item;
}

describe('fakeExtras', () => {
  it('reads known pack names, ignoring case, spaces and unknown words', () => {
    expect(fakeExtras(' Board, nope,stress ')).toEqual(new Set(['board', 'stress']));
    expect(fakeExtras(undefined)).toEqual(new Set());
  });
});

describe('POSTPILE_FAKE_EXTRA=board', () => {
  it('keeps the default sample when no pack is asked for', async () => {
    const plain = await new FakeEngine({ now: () => NOW }).listTopics();
    expect(plain.some((item) => item.topic.id === BOARD_TOPIC.releaseNotes)).toBe(false);
  });

  it('shows an approved own PR as a merge move that is not urgent (BOARD-07, BOARD-22 C)', async () => {
    const engine = engineWith('board');
    const item = await topicItem(engine, BOARD_TOPIC.releaseNotes);
    expect(item).toMatchObject({ section: 'you_drive', quiet: false, unreadTiles: 0, urgentUnreadTiles: 0 });
    const view = await tileOf(engine, 2001);
    expect(view.turn).toMatchObject({ kind: 'you', move: 'merge' });
    expect(view.group).toBe('open');
  });

  it('has the You drive trio: unread, dealt with, merge-ready (BOARD-22)', async () => {
    const engine = engineWith('board');
    expect(await topicItem(engine, BOARD_TOPIC.searchRelevance)).toMatchObject({ section: 'you_drive', quiet: false, unreadTiles: 1 });
    expect(await topicItem(engine, BOARD_TOPIC.locale)).toMatchObject({ section: 'you_drive', quiet: true, unreadTiles: 0 });
  });

  it('puts the own draft in Dealt with next to two merged PRs (BOARD-33)', async () => {
    const engine = engineWith('board');
    const tiles = (await engine.getTopic(BOARD_TOPIC.docsLint))?.tiles ?? [];
    expect(tiles.map((view) => view.group)).toEqual(['dealt_with', 'dealt_with', 'dealt_with']);
    expect((await engine.getTopic(BOARD_TOPIC.docsLint))?.archive).toBeNull();
  });

  it("keeps a teammate's draft out of To review and off your moves (BOARD-09)", async () => {
    const engine = engineWith('board');
    const view = await tileOf(engine, 2010);
    expect(view).toMatchObject({ draft: true, group: 'unread' });
    expect(view.turn.kind).toBe('none');
    expect(view.prs[0]?.tier).not.toBe('to_review');
    expect((await topicItem(engine, BOARD_TOPIC.devboxPrebuilds)).section).toBe('team_owns');
  });

  it('tells a thanks from a question (BOARD-05)', async () => {
    const engine = engineWith('board');
    expect((await tileOf(engine, 2012)).turn.kind).toBe('none');
    expect((await tileOf(engine, 2012)).prs[0]?.tier).not.toBe('needs_reply');
    expect((await tileOf(engine, 2013)).turn).toMatchObject({ kind: 'you', move: 'reply' });
  });

  it('marks a Not yours merge done, and a closed PR nobody else moves (BOARD-19, BOARD-21)', async () => {
    const engine = engineWith('board');
    const merged = await tileOf(engine, 2014);
    expect(merged.prs[0]?.done).toBe(true);
    expect(merged.verdict?.verdict).toBe('NOT_YOURS');
    const closed = await tileOf(engine, 2015);
    expect(closed).toMatchObject({ group: 'unread', turn: { kind: 'none' } });
    expect((await tileOf(engine, 2016)).prs[0]?.state).toBe('OPEN');
  });

  it('keeps the standing Release train in the Archive (BOARD-35)', async () => {
    const engine = engineWith('board');
    expect((await engine.listFinishedTopics()).map((topic) => topic.id)).toContain(BOARD_TOPIC.releaseTrain);
    expect((await engine.getTopic(BOARD_TOPIC.releaseTrain))?.topic).toMatchObject({ kind: 'standing', status: 'retired' });
  });

  it('waits on the first of several reviewers on an own PR (BOARD-08)', async () => {
    const view = await tileOf(engineWith('board'), 2019);
    expect(view.turn).toMatchObject({ kind: 'them', who: 'lyra' });
  });

  it('tells an approval right after an unread comment from one after reading it (BOARD-17)', async () => {
    const engine = engineWith('board');
    expect(await tileOf(engine, 2020)).toMatchObject({ group: 'unread', turn: { kind: 'them', who: 'sol' } });
    expect(await tileOf(engine, 2021)).toMatchObject({ group: 'dealt_with', turn: { kind: 'them', who: 'sol' } });
  });
});

describe('POSTPILE_FAKE_EXTRA=stress', () => {
  it('has a long title with emoji, backticks, angle brackets and an unbroken token, and a long topic name', async () => {
    const engine = engineWith('stress');
    expect(STRESS_LONG_TITLE.length).toBeGreaterThanOrEqual(220);
    expect(STRESS_LONG_TITLE).toMatch(/`.+`/);
    expect(STRESS_LONG_TITLE).toMatch(/<\w+>/);
    expect(Math.max(...STRESS_LONG_TITLE.split(' ').map((word) => word.length))).toBeGreaterThanOrEqual(90);
    expect((await topicItem(engine, STRESS_TOPIC.longName)).topic.name).toBe(STRESS_TOPIC_NAME);
    expect(STRESS_TOPIC_NAME.length).toBeGreaterThan(64);
  });

  it('has a PR above #9999 in a repo with a long name, and an agent PR with five assignees', async () => {
    const engine = engineWith('stress');
    const big = await tileOf(engine, STRESS_BIG_NUMBER);
    expect(big.prs[0]?.key).toMatch(/^acme\/.{40,}#12345$/);
    expect((await tileOf(engine, 2402)).prs[0]?.assignees).toHaveLength(5);
  });

  it('has a topic with 25 tiles, 30 PRs and at least seven authors', async () => {
    const tiles = (await engineWith('stress').getTopic(STRESS_TOPIC.crowded))?.tiles ?? [];
    const prs = tiles.flatMap((view) => view.prs);
    expect(tiles).toHaveLength(25);
    expect(prs).toHaveLength(30);
    expect(new Set(prs.map((pr) => pr.author)).size).toBeGreaterThanOrEqual(7);
  });

  it('has a dossier at every bound', async () => {
    const dossier = (await engineWith('stress').getTopic(STRESS_TOPIC.crowded))?.dossier?.dossier;
    expect(dossier?.goal).toHaveLength(DOSSIER_LIMITS.goal);
    expect(dossier?.summary).toHaveLength(DOSSIER_LIMITS.summary);
    expect(dossier?.people).toHaveLength(DOSSIER_LIMITS.people);
    expect(dossier?.openQuestions).toHaveLength(DOSSIER_LIMITS.openQuestions);
    expect(dossier?.timeline).toHaveLength(DOSSIER_LIMITS.timeline);
    expect(dossier?.recentChanges).toHaveLength(DOSSIER_LIMITS.recentChanges);
    expect(dossier?.userCares).toHaveLength(DOSSIER_LIMITS.userCares);
  });
});

describe('POSTPILE_FAKE_EXTRA=calm', () => {
  it('replaces the sample with topics where nothing is left for you', async () => {
    const engine = engineWith('calm');
    const items = await engine.listTopics();
    expect(items.map((item) => item.topic.id).toSorted()).toEqual(Object.values(CALM_TOPIC).toSorted());
    expect(items.reduce((sum, item) => sum + item.unreadTiles, 0)).toBe(0);
    expect(items.every((item) => item.quiet && item.yourMoves.length === 0)).toBe(true);
    expect(await engine.listFinishedTopics()).toEqual([]);
  });

  it('offers Archive now on the merged topics, and holds one topic with only a snoozed tile', async () => {
    const engine = engineWith('calm');
    for (const id of [CALM_TOPIC.lintConfig, CALM_TOPIC.runnerCleanup, CALM_TOPIC.docsCache]) {
      expect((await engine.getTopic(id))?.archive?.state, id).toBe('ready');
    }
    const snoozed = await engine.getTopic(CALM_TOPIC.flagCleanup);
    expect(snoozed?.tiles.map((view) => view.state.kind)).toEqual(['snoozed']);
    expect(snoozed?.dossier).toBeNull();
  });

  it('refuses to start next to another pack', () => {
    expect(() => engineWith('calm', 'board')).toThrow(/cannot be combined/);
  });
});
