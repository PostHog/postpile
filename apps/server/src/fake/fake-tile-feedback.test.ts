// Tile feedback in fake mode behaves like FeedbackActions: a move takes the
// PR plus its stack, never its set; "Not related" leaves the PR as its own
// tile; "Wrong topic" without a target sends it to Unsorted.
import { UNSORTED_TOPIC_ID } from '@postpile/engine';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const NOW = new Date('2026-09-27T10:00:00Z');
const SET_TILE = 'set:turbo-cache';

function engine(): FakeEngine {
  return new FakeEngine({ now: () => NOW, syncStepMs: 0 });
}

async function tileKeys(fake: FakeEngine, topicId: string): Promise<Map<string, string[]>> {
  const topic = await fake.getTopic(topicId);
  return new Map((topic?.tiles ?? []).map((view) => [view.tile.id, view.tile.members.map((member) => member.prKey)]));
}

function feedback(kind: 'wrong_topic' | 'not_related', prKey: string | null, targetTopicId: string | null = null, tileId = SET_TILE) {
  return { kind, tileId, prKey, targetTopicId, note: '' } as const;
}

describe('fake tile feedback', () => {
  it('moves one set member to another topic and leaves the rest of the set', async () => {
    const fake = engine();
    expect(await fake.giveFeedback(feedback('wrong_topic', 'acme/app#1855', 'topic-ci-tests'))).toMatchObject({ ok: true, message: 'Moved' });
    expect((await tileKeys(fake, 'topic-depot')).get(SET_TILE)).toEqual(['acme/app#1904', 'acme/app#1907', 'acme/app#1921']);
    expect((await tileKeys(fake, 'topic-ci-tests')).get('pr:acme/app#1855')).toEqual(['acme/app#1855']);
  });

  it('moves a stack layer together with its stack, as a stack tile', async () => {
    const fake = engine();
    await fake.giveFeedback(feedback('wrong_topic', 'acme/app#1907', 'topic-ci-tests'));
    expect((await tileKeys(fake, 'topic-depot')).get(SET_TILE)).toEqual(['acme/app#1921', 'acme/app#1855']);
    const moved = (await fake.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === 'stack:acme/app#1904');
    expect(moved?.tile).toMatchObject({ kind: 'stack', title: 'Hash Turbo inputs by lockfile only (stack of 2)' });
    expect(moved?.tile.members.map((member) => member.prKey)).toEqual(['acme/app#1904', 'acme/app#1907']);
  });

  it('keeps a "not related" PR in its topic as its own tile, and ends a set left with one unit', async () => {
    const fake = engine();
    expect(await fake.giveFeedback(feedback('not_related', 'acme/app#1855'))).toMatchObject({ ok: true, message: 'Removed from the set' });
    let depot = await tileKeys(fake, 'topic-depot');
    expect(depot.get('pr:acme/app#1855')).toEqual(['acme/app#1855']);
    expect(depot.get(SET_TILE)).toEqual(['acme/app#1904', 'acme/app#1907', 'acme/app#1921']);

    await fake.giveFeedback(feedback('not_related', 'acme/app#1921'));
    depot = await tileKeys(fake, 'topic-depot');
    expect(depot.has(SET_TILE)).toBe(false);
    expect(depot.get('stack:acme/app#1904')).toEqual(['acme/app#1904', 'acme/app#1907']);
    expect(depot.get('pr:acme/app#1921')).toEqual(['acme/app#1921']);
  });

  it('refuses "not related" outside a set, like the engine', async () => {
    const result = await engine().giveFeedback(feedback('not_related', 'acme/infra#1915', null, 'pr:acme/infra#1915'));
    expect(result).toMatchObject({ ok: false, message: '"Not related" needs a set tile and the PR to drop' });
  });

  it('sends a "wrong topic" without a target to Unsorted until the next sync', async () => {
    const fake = engine();
    const result = await fake.giveFeedback(feedback('wrong_topic', null, null, 'pr:acme/infra#1915'));
    expect(result).toMatchObject({ ok: true, message: 'Will be re-sorted on the next sync' });
    expect((await tileKeys(fake, 'topic-depot')).has('pr:acme/infra#1915')).toBe(false);
    expect((await tileKeys(fake, UNSORTED_TOPIC_ID)).get('pr:acme/infra#1915')).toEqual(['acme/infra#1915']);
    expect((await fake.listTopics()).some((item) => item.topic.id === UNSORTED_TOPIC_ID)).toBe(true);
  });
});
