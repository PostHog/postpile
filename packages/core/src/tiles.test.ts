import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeReview, makeThreadFor, makeUserState, singleTile } from './fixtures.ts';
import { buildStacks } from './stacks.ts';
import {
  buildTopicTiles,
  deriveTileState,
  explainTileState,
  isPrDone,
  setIdFromTileId,
  setTileId,
  singleTileId,
  type TileStateInput,
} from './tiles.ts';
import type { Pr, PrEvent, PrSet, Tile, UserPrState } from './types.ts';

function stateInput(tile: Tile, prs: Pr[], events: PrEvent[], userStates: UserPrState[] = []): TileStateInput {
  const eventMap = new Map<string, PrEvent[]>();
  for (const event of events) {
    eventMap.set(event.prKey, [...(eventMap.get(event.prKey) ?? []), event]);
  }
  return {
    tile,
    prs: new Map(prs.map((pr) => [pr.key, pr])),
    events: eventMap,
    userStates: new Map(userStates.map((s) => [s.prKey, s])),
    snooze: null,
    now: at(100),
    viewerLogin: 'viewer',
  };
}

describe('isPrDone', () => {
  it('is done when merged or closed', () => {
    expect(isPrDone(makePr({ state: 'MERGED' }), null)).toBe(true);
    expect(isPrDone(makePr({ state: 'CLOSED' }), null)).toBe(true);
  });

  it('is done when handled or approved at the current head', () => {
    const pr = makePr({ headOid: 'h2' });
    expect(isPrDone(pr, null)).toBe(false);
    expect(isPrDone(pr, makeUserState({ handledAt: at(1) }))).toBe(true);
    expect(isPrDone(pr, makeUserState({ approvedAt: at(1), approvedCommitOid: 'h2' }))).toBe(true);
  });

  it('is not done once someone pushed after the approval', () => {
    const pr = makePr({ headOid: 'h3' });
    expect(isPrDone(pr, makeUserState({ approvedAt: at(1), approvedCommitOid: 'h2' }))).toBe(false);
  });

  it('counts an approval of the current head made on github.com', () => {
    const pr = makePr({ headOid: 'h2', reviews: [makeReview({ author: 'viewer', commitOid: 'h2' })] });
    expect(isPrDone(pr, null, 'viewer')).toBe(true);
    expect(isPrDone(pr, null)).toBe(false);
  });
});

describe('deriveTileState', () => {
  const pr = makePr();
  const tile = singleTile(pr);

  it('is unread with the PR and event that caused it', () => {
    const loud = makeEvent({ id: 'e1', kind: 'mention', ruleLoudness: 'loud', summary: 'bob mentioned you' });
    const state = deriveTileState(stateInput(tile, [pr], [loud]));
    expect(state).toEqual({
      kind: 'unread',
      unreadBecause: [{ prKey: pr.key, eventId: 'e1', kind: 'mention', summary: 'bob mentioned you', at: loud.at }],
    });
    expect(explainTileState(state)).toBe('unread (PostHog/posthog#1: bob mentioned you)');
  });

  it('lists every unseen loud event, oldest first, and skips seen and quiet ones', () => {
    const events = [
      makeEvent({ id: 'late', ruleLoudness: 'loud', at: at(30) }),
      makeEvent({ id: 'early', ruleLoudness: 'loud', at: at(10) }),
      makeEvent({ id: 'seen', ruleLoudness: 'loud', at: at(5), seenAt: at(6) }),
      makeEvent({ id: 'quiet', ruleLoudness: 'quiet', at: at(7) }),
    ];
    const state = deriveTileState(stateInput(tile, [pr], events));
    expect(state.unreadBecause.map((r) => r.eventId)).toEqual(['early', 'late']);
  });

  it('respects an agent override that mutes a loud event', () => {
    const muted = makeEvent({ ruleLoudness: 'loud', override: { loudness: 'muted', reason: 'noise', by: 'agent' } });
    expect(deriveTileState(stateInput(tile, [pr], [muted])).kind).toBe('open');
  });

  it('is open while a pinged PR still needs the user', () => {
    expect(deriveTileState(stateInput(tile, [pr], [])).kind).toBe('open');
  });

  it('is done when every pinged PR is done, ignoring pulled-in ones', () => {
    const pulledIn = makePr({ number: 2 });
    const setTile: Tile = {
      ...tile,
      kind: 'set',
      members: [...tile.members, { prKey: pulledIn.key, provenance: { kind: 'pulled_in', reason: 'context' } }],
    };
    const approved = makeUserState({ approvedAt: at(1), approvedCommitOid: 'head' });
    expect(deriveTileState(stateInput(setTile, [pr, pulledIn], [], [approved])).kind).toBe('done');
  });

  it('counts loud events on pulled-in PRs too', () => {
    const pulledIn = makePr({ number: 2 });
    const setTile: Tile = {
      ...tile,
      members: [...tile.members, { prKey: pulledIn.key, provenance: { kind: 'pulled_in', reason: 'context' } }],
    };
    const loud = makeEvent({ prKey: pulledIn.key, ruleLoudness: 'loud' });
    const approved = makeUserState({ approvedAt: at(1), approvedCommitOid: 'head' });
    expect(deriveTileState(stateInput(setTile, [pr, pulledIn], [loud], [approved])).kind).toBe('unread');
  });

  it('is snoozed while the condition holds, even with older unseen loud events', () => {
    const input = stateInput(tile, [pr], [makeEvent({ ruleLoudness: 'loud', at: at(5) })]);
    input.snooze = { tileId: tile.id, condition: { kind: 'until_time', until: at(200) }, since: at(10) };
    expect(deriveTileState(input).kind).toBe('snoozed');
  });

  it('wakes from a snooze when the condition is met', () => {
    const input = stateInput(tile, [pr], []);
    input.snooze = { tileId: tile.id, condition: { kind: 'until_time', until: at(50) }, since: at(10) };
    expect(deriveTileState(input).kind).toBe('open');
  });

  it('wakes from a snooze on a loud human event after it started', () => {
    const input = stateInput(tile, [pr], [makeEvent({ kind: 'mention', ruleLoudness: 'loud', at: at(20) })]);
    input.snooze = { tileId: tile.id, condition: { kind: 'new_push' }, since: at(10) };
    expect(deriveTileState(input).kind).toBe('unread');
  });
});

describe('buildTopicTiles', () => {
  const a = makePr({ number: 1, headRef: 'b1' });
  const b = makePr({ number: 2, baseRef: 'b1', headRef: 'b2' });
  const lone = makePr({ number: 3 });
  const quiet = makePr({ number: 4 });
  const prs = new Map([a, b, lone, quiet].map((pr) => [pr.key, pr]));

  it('builds stack tiles, then sets, then singles, and drops tiles nobody pinged', () => {
    const set: PrSet = {
      id: 's1',
      topicId: 'topic-1',
      title: 'Depot runners',
      take: 'both move jobs to depot',
      members: [
        { prKey: lone.key, reason: 'moves the build job' },
        { prKey: quiet.key, reason: 'moves the test job' },
      ],
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: at(0),
      updatedAt: at(0),
    };
    const tiles = buildTopicTiles({
      topicId: 'topic-1',
      memberKeys: [a.key, b.key, lone.key, quiet.key],
      prs,
      threads: new Map([
        [b.key, makeThreadFor(b)],
        [lone.key, makeThreadFor(lone, { reason: 'mention' })],
      ]),
      stacks: buildStacks([a, b, lone, quiet]),
      sets: [set],
      pullInReasons: new Map([[a.key, 'stack layer below #2']]),
    });
    expect(tiles.map((t) => [t.id, t.kind, t.title])).toEqual([
      ['stack:PostHog/posthog#1', 'stack', 'PR 1 (stack of 2)'],
      ['set:s1', 'set', 'Depot runners'],
    ]);
    expect(tiles[0]?.members.map((m) => m.provenance)).toEqual([
      { kind: 'pulled_in', reason: 'stack layer below #2' },
      { kind: 'pinged', reason: 'review_requested' },
    ]);
    expect(tiles[1]?.members[1]?.provenance).toEqual({ kind: 'pulled_in', reason: 'moves the test job' });
  });

  it('gives each remaining pinged PR a single tile', () => {
    const tiles = buildTopicTiles({
      topicId: 'topic-1',
      memberKeys: [lone.key, quiet.key],
      prs,
      threads: new Map([[lone.key, makeThreadFor(lone)]]),
      stacks: [],
      sets: [],
    });
    expect(tiles.map((t) => t.id)).toEqual(['pr:PostHog/posthog#3']);
  });

  it('shows a pulled-in set member as pinged once it gets a mention', () => {
    const set: PrSet = {
      id: 's1',
      topicId: 'topic-1',
      title: 'set',
      take: '',
      members: [{ prKey: quiet.key, reason: 'context' }],
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: at(0),
      updatedAt: at(0),
    };
    const base = { topicId: 'topic-1', memberKeys: [], prs, threads: new Map(), stacks: [], sets: [set] };
    expect(buildTopicTiles(base)).toEqual([]);
    const mention = makeEvent({ prKey: quiet.key, kind: 'mention', ruleLoudness: 'loud' });
    const tiles = buildTopicTiles({ ...base, events: new Map([[quiet.key, [mention]]]) });
    expect(tiles[0]?.members[0]?.provenance).toEqual({ kind: 'pinged', reason: 'mention' });
  });
});

describe('tile ids', () => {
  it('parses the set id back out of a set tile id only', () => {
    expect(setIdFromTileId(setTileId('s1'))).toBe('s1');
    expect(setIdFromTileId(singleTileId('PostHog/posthog#1'))).toBeNull();
    expect(setIdFromTileId('stack:PostHog/posthog#1')).toBeNull();
  });
});
