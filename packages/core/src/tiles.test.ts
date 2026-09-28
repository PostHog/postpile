import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeReview, makeThreadFor, makeUserState, singleTile, viewer } from './fixtures.ts';
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
import type { Pr, PrEvent, PrSet, Tile, UserPrState, Viewer } from './types.ts';

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
    viewer: teamViewer,
  };
}

const teamViewer: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };
const handled = makeUserState({ handledAt: at(50) });

describe('isPrDone', () => {
  it('is done when merged or closed', () => {
    expect(isPrDone(makePr({ state: 'MERGED' }), null)).toBe(true);
    expect(isPrDone(makePr({ state: 'CLOSED' }), null)).toBe(true);
  });

  it('is done when handled or approved at the current head', () => {
    const pr = makePr({ headOid: 'h2' });
    expect(isPrDone(pr, null)).toBe(false);
    expect(isPrDone(pr, makeUserState({ handledAt: at(1) }))).toBe(true);
    expect(isPrDone(pr, makeUserState({ handledAt: at(1) }), teamViewer)).toBe(true);
    expect(isPrDone(pr, makeUserState({ approvedAt: at(1), approvedCommitOid: 'h2' }))).toBe(true);
  });

  it('is not done after mark-read while your personal review is pending', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [viewer.login] });
    expect(isPrDone(pr, handled, teamViewer)).toBe(false);
  });

  it('is not done after mark-read while a team review is pending on a teammate\'s PR', () => {
    const pr = makePr({ author: 'lyra', reviewerTeams: ['PostHog/team-devex'] });
    expect(isPrDone(pr, handled, teamViewer)).toBe(false);
  });

  it('is not done after mark-read while a routed team review is pending without your review', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: ['PostHog/team-devex'] });
    expect(isPrDone(pr, handled, teamViewer)).toBe(false);
  });

  it('is done after mark-read once a teammate took the routed team request', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: ['PostHog/team-devex'], reviews: [makeReview({ author: 'lyra' })] });
    expect(isPrDone(pr, handled, teamViewer)).toBe(true);
  });

  it('is done after mark-read once you reviewed the head and nothing else is asked', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [viewer.login], reviews: [makeReview({ author: viewer.login, state: 'COMMENTED' })] });
    expect(isPrDone(pr, handled, teamViewer)).toBe(true);
  });

  it('is done once you approved, and once it merged, even with the request still listed', () => {
    const pr = makePr({ author: 'lyra', reviewerUsers: [viewer.login], reviewerTeams: ['PostHog/team-devex'] });
    const approved = { ...pr, reviews: [makeReview({ author: viewer.login, commitOid: 'old' })] };
    expect(isPrDone(approved, null, teamViewer)).toBe(true);
    expect(isPrDone({ ...pr, state: 'MERGED' }, null, teamViewer)).toBe(true);
  });

  it('is not done after mark-read while an ask to you is unanswered', () => {
    const pr = makePr({ author: 'ada' });
    const question = makeEvent({ kind: 'question_to_user', actor: 'ada', at: at(30), seenAt: at(40) });
    expect(isPrDone(pr, handled, teamViewer, [question])).toBe(false);
    expect(isPrDone(pr, handled, teamViewer)).toBe(true);
  });

  it('stays done when someone pushed after the approval', () => {
    const pr = makePr({ headOid: 'h3' });
    expect(isPrDone(pr, makeUserState({ approvedAt: at(1), approvedCommitOid: 'h2' }))).toBe(true);
  });

  it('counts an approval made on github.com, on any commit', () => {
    const pr = makePr({ headOid: 'h3', reviews: [makeReview({ author: 'viewer', commitOid: 'h2' })] });
    expect(isPrDone(pr, null, viewer)).toBe(true);
    expect(isPrDone(pr, null)).toBe(false);
  });

  it('is not done when the newer review of the viewer asks for changes', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'a', author: 'viewer', state: 'APPROVED', submittedAt: at(1) }),
        makeReview({ id: 'b', author: 'viewer', state: 'CHANGES_REQUESTED', submittedAt: at(2) }),
      ],
    });
    expect(isPrDone(pr, null, viewer)).toBe(false);
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
      unreadBecause: [{ prKey: pr.key, eventId: 'e1', kind: 'mention', actor: 'bob', summary: 'bob mentioned you', at: loud.at }],
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

describe('buildTopicTiles with stacks as units', () => {
  const bottom = makePr({ number: 1, headRef: 'b1', state: 'MERGED', mergedAt: at(50) });
  const middle = makePr({ number: 2, baseRef: 'b1', headRef: 'b2', isDraft: true });
  const top = makePr({ number: 3, baseRef: 'b2', headRef: 'b3', state: 'CLOSED', updatedAt: at(60) });
  const other = makePr({ number: 4 });
  const all = [bottom, middle, top, other];
  const prs = new Map(all.map((pr) => [pr.key, pr]));
  const stacks = buildStacks(all);
  const stackId = 'stack:PostHog/posthog#1';

  function setOf(keys: string[]): PrSet {
    return {
      id: 's1',
      topicId: 'topic-1',
      title: 'Depot runners',
      take: '',
      members: keys.map((prKey) => ({ prKey, reason: 'same rollout' })),
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: at(0),
      updatedAt: at(0),
    };
  }

  const threads = new Map([
    [middle.key, makeThreadFor(middle)],
    [other.key, makeThreadFor(other)],
  ]);

  it('shows every layer in order, whatever its state', () => {
    const tiles = buildTopicTiles({ topicId: 'topic-1', memberKeys: [middle.key], prs, threads, stacks, sets: [] });
    expect(tiles.map((t) => [t.id, t.members.map((m) => m.prKey)])).toEqual([[stackId, [bottom.key, middle.key, top.key]]]);
  });

  it('shows a stack only in its own topic, and keeps its layers out of other topics', () => {
    const stackTopicIds = new Map([[stackId, 'topic-2']]);
    const here = buildTopicTiles({ topicId: 'topic-1', memberKeys: [middle.key, other.key], prs, threads, stacks, stackTopicIds, sets: [] });
    expect(here.map((t) => t.id)).toEqual(['pr:PostHog/posthog#4']);
    const home = buildTopicTiles({ topicId: 'topic-2', memberKeys: [], prs, threads, stacks, stackTopicIds, sets: [] });
    expect(home.map((t) => [t.id, t.members.length])).toEqual([[stackId, 3]]);
  });

  it('pulls the whole stack into a set that names one layer, instead of tearing the layer out', () => {
    const tiles = buildTopicTiles({
      topicId: 'topic-1',
      memberKeys: [middle.key, other.key],
      prs,
      threads,
      stacks,
      sets: [setOf([other.key, middle.key])],
    });
    expect(tiles.map((t) => [t.id, t.members.map((m) => m.prKey)])).toEqual([
      ['set:s1', [other.key, bottom.key, middle.key, top.key]],
    ]);
    expect(tiles[0]?.members.map((m) => m.provenance.kind)).toEqual(['pinged', 'pulled_in', 'pinged', 'pulled_in']);
  });

  it('keeps the stack tile when a set would hold nothing but that stack', () => {
    const tiles = buildTopicTiles({ topicId: 'topic-1', memberKeys: [middle.key], prs, threads, stacks, sets: [setOf([middle.key, top.key])] });
    expect(tiles.map((t) => t.id)).toEqual([stackId]);
  });

  it('leaves a stack shown in another topic out of this topic\'s sets', () => {
    const tiles = buildTopicTiles({
      topicId: 'topic-1',
      memberKeys: [other.key],
      prs,
      threads,
      stacks,
      stackTopicIds: new Map([[stackId, 'topic-2']]),
      sets: [setOf([other.key, middle.key])],
    });
    expect(tiles.map((t) => [t.id, t.members.map((m) => m.prKey)])).toEqual([['set:s1', [other.key]]]);
  });
});

describe('tile ids', () => {
  it('parses the set id back out of a set tile id only', () => {
    expect(setIdFromTileId(setTileId('s1'))).toBe('s1');
    expect(setIdFromTileId(singleTileId('PostHog/posthog#1'))).toBeNull();
    expect(setIdFromTileId('stack:PostHog/posthog#1')).toBeNull();
  });
});

describe('found PRs', () => {
  const pr = makePr({ number: 9 });
  const found = { prKey: pr.key, via: 'review_requested' as const, reason: 'review requested from you', foundAt: at(0) };

  it('builds a tile for a found PR without a thread', () => {
    const tiles = buildTopicTiles({ topicId: 't', memberKeys: [pr.key], prs: new Map([[pr.key, pr]]), threads: new Map(), stacks: [], sets: [], found: new Map([[pr.key, found]]) });
    expect(tiles.map((tile) => tile.members[0]?.provenance)).toEqual([{ kind: 'found', via: 'review_requested', reason: 'review requested from you' }]);
  });

  it('never makes the tile unread from a found PR', () => {
    const tile: Tile = { id: 'pr:x', topicId: 't', kind: 'single', title: 'x', members: [{ prKey: pr.key, provenance: { kind: 'found', via: 'review_requested', reason: 'r' } }] };
    const loud = makeEvent({ prKey: pr.key, ruleLoudness: 'loud' });
    expect(deriveTileState(stateInput(tile, [pr], [loud])).kind).toBe('open');
  });

  it('turns pinged and unread once a thread appears', () => {
    const tiles = buildTopicTiles({
      topicId: 't',
      memberKeys: [pr.key],
      prs: new Map([[pr.key, pr]]),
      threads: new Map([[pr.key, makeThreadFor(pr)]]),
      stacks: [],
      sets: [],
      found: new Map([[pr.key, found]]),
    });
    const loud = makeEvent({ prKey: pr.key, ruleLoudness: 'loud' });
    expect(tiles[0]?.members[0]?.provenance.kind).toBe('pinged');
    expect(deriveTileState(stateInput(tiles[0]!, [pr], [loud])).kind).toBe('unread');
  });
});
