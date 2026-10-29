import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScoutedPr, ScoutJudgement } from '@postpile/core';
import { Store } from './index.ts';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

function judgement(overrides: Partial<ScoutJudgement> = {}): ScoutJudgement {
  return {
    scoutId: 'lookout',
    prKey: 'acme/app#10',
    status: 'judged',
    verdict: 'skipped',
    reason: 'no path signal',
    inputHash: 'h1',
    configVersion: 1,
    headOid: 'abc',
    observedUpdatedAt: '2026-10-29T10:00:00.000Z',
    attempts: 0,
    lastError: null,
    judgedAt: '2026-10-29T10:05:00.000Z',
    leftOut: null,
    ...overrides,
  };
}

function scouted(overrides: Partial<ScoutedPr> = {}): ScoutedPr {
  return {
    prKey: 'acme/app#10',
    scoutId: 'lookout',
    scoutName: 'Lookout',
    configVersion: 1,
    reason: 'adds a new top-level folder billing/',
    pulledAt: '2026-10-29T10:05:00.000Z',
    seenUpdatedAt: null,
    followedAt: null,
    dismissedAt: null,
    dismissReason: null,
    expiredAt: null,
    expiryReason: null,
    ...overrides,
  };
}

describe('ScoutsVersionRepo', () => {
  it('numbers versions and reads the newest', () => {
    expect(store.scoutsVersions.latest()).toBeNull();
    store.scoutsVersions.add({ text: 'a', summary: 'Found on disk', origin: 'outside', createdAt: '2026-10-29T10:00:00.000Z' });
    const second = store.scoutsVersions.add({ text: 'b', summary: 'Edited outside the app', origin: 'outside', createdAt: '2026-10-29T11:00:00.000Z' });

    expect(second.version).toBe(2);
    expect(store.scoutsVersions.latest()).toEqual(second);
    expect(store.scoutsVersions.get(1)?.text).toBe('a');
    expect(store.scoutsVersions.list(10).map((version) => version.version)).toEqual([2, 1]);
    expect(store.scoutsVersions.listAll().map((version) => version.version)).toEqual([2, 1]);
  });
});

describe('ScoutCursorRepo', () => {
  it('stores a cursor and only ever moves it forward', () => {
    store.scoutCursors.advance('lookout', 'acme/app', '2026-10-29T10:00:00.000Z', '2026-10-29T10:01:00.000Z');
    store.scoutCursors.advance('lookout', 'acme/app', '2026-10-29T09:00:00.000Z', '2026-10-29T10:02:00.000Z');
    expect(store.scoutCursors.get('lookout', 'acme/app')).toEqual({
      scoutId: 'lookout',
      repo: 'acme/app',
      coveredThrough: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:01:00.000Z',
    });

    store.scoutCursors.advance('lookout', 'acme/app', '2026-10-29T11:00:00.000Z', '2026-10-29T11:01:00.000Z');
    expect(store.scoutCursors.get('lookout', 'acme/app')?.coveredThrough).toBe('2026-10-29T11:00:00.000Z');
    expect(store.scoutCursors.get('lookout', 'acme/web')).toBeNull();
    expect(store.scoutCursors.listAll()).toHaveLength(1);
  });
});

describe('ScoutJudgementRepo', () => {
  it('writes a whole row and replaces it on the next save', () => {
    store.scoutJudgements.save(judgement({ status: 'pending', verdict: null, reason: null, judgedAt: null, lastError: 'files not complete' }));
    expect(store.scoutJudgements.listPending('lookout').map((row) => row.prKey)).toEqual(['acme/app#10']);

    store.scoutJudgements.save(judgement({ verdict: 'pulled', reason: 'new service', attempts: 1 }));
    expect(store.scoutJudgements.get('lookout', 'acme/app#10')).toEqual(judgement({ verdict: 'pulled', reason: 'new service', attempts: 1 }));
    expect(store.scoutJudgements.listPending('lookout')).toEqual([]);
  });

  it('refuses a pending row with a verdict and a judged one without', () => {
    expect(() => store.scoutJudgements.save(judgement({ status: 'pending' }))).toThrow();
    expect(() => store.scoutJudgements.save(judgement({ verdict: null }))).toThrow();
  });

  it("reads one scout's rows for a set of PRs, and every scout's for one PR", () => {
    store.scoutJudgements.save(judgement());
    store.scoutJudgements.save(judgement({ prKey: 'acme/app#11' }));
    store.scoutJudgements.save(judgement({ scoutId: 'billing', judgedAt: '2026-10-29T10:06:00.000Z' }));

    expect([...store.scoutJudgements.getMany('lookout', ['acme/app#10', 'acme/app#12']).keys()]).toEqual(['acme/app#10']);
    expect(store.scoutJudgements.getMany('lookout', [])).toEqual(new Map());
    expect(store.scoutJudgements.forPr('acme/app#10').map((row) => row.scoutId)).toEqual(['lookout', 'billing']);
  });

  it('deletes only skipped rows observed before the cutoff', () => {
    store.scoutJudgements.save(judgement({ prKey: 'acme/app#1', observedUpdatedAt: '2026-09-01T00:00:00.000Z' }));
    store.scoutJudgements.save(judgement({ prKey: 'acme/app#2', observedUpdatedAt: '2026-09-01T00:00:00.000Z', verdict: 'pulled' }));
    store.scoutJudgements.save(judgement({ prKey: 'acme/app#3', observedUpdatedAt: '2026-09-01T00:00:00.000Z', status: 'pending', verdict: null, judgedAt: null }));
    store.scoutJudgements.save(judgement({ prKey: 'acme/app#4', observedUpdatedAt: '2026-10-20T00:00:00.000Z' }));

    expect(store.scoutJudgements.deleteSkippedBefore('2026-10-01T00:00:00.000Z')).toBe(1);
    expect(store.scoutJudgements.get('lookout', 'acme/app#1')).toBeNull();
    expect(store.scoutJudgements.forPr('acme/app#2')).toHaveLength(1);
    expect(store.scoutJudgements.forPr('acme/app#3')).toHaveLength(1);
    expect(store.scoutJudgements.forPr('acme/app#4')).toHaveLength(1);
  });
});

describe('ScoutedPrRepo', () => {
  it('keeps the first scout that pulled a PR', () => {
    expect(store.scoutedPrs.insert(scouted())).toBe(true);
    expect(store.scoutedPrs.insert(scouted({ scoutId: 'billing', scoutName: 'Billing' }))).toBe(false);
    expect(store.scoutedPrs.get('acme/app#10')?.scoutId).toBe('lookout');
  });

  it('marks seen through an update and never moves it back', () => {
    store.scoutedPrs.insert(scouted());
    expect(store.scoutedPrs.markSeen('acme/app#10', '2026-10-29T11:00:00.000Z')).toBe(true);
    expect(store.scoutedPrs.markSeen('acme/app#10', '2026-10-29T10:00:00.000Z')).toBe(false);
    expect(store.scoutedPrs.get('acme/app#10')?.seenUpdatedAt).toBe('2026-10-29T11:00:00.000Z');
  });

  it('takes a PR off the board when followed, dismissed or expired, and keeps the row', () => {
    store.scoutedPrs.insert(scouted({ prKey: 'acme/app#1' }));
    store.scoutedPrs.insert(scouted({ prKey: 'acme/app#2' }));
    store.scoutedPrs.insert(scouted({ prKey: 'acme/app#3' }));
    store.scoutedPrs.insert(scouted({ prKey: 'acme/app#4' }));

    expect(store.scoutedPrs.markFollowed('acme/app#1', '2026-10-29T12:00:00.000Z')).toBe(true);
    expect(store.scoutedPrs.dismiss('acme/app#2', '2026-10-29T12:00:00.000Z', 'not our area')).toBe(true);
    expect(store.scoutedPrs.expire('acme/app#3', '2026-10-29T12:00:00.000Z', 'merged')).toBe(true);
    // A dismissed PR does not expire on top of it.
    expect(store.scoutedPrs.expire('acme/app#2', '2026-10-29T12:00:00.000Z', 'inactive')).toBe(false);

    expect(store.scoutedPrs.listActive().map((row) => row.prKey)).toEqual(['acme/app#4']);
    expect(store.scoutedPrs.listAll()).toHaveLength(4);
    expect(store.scoutedPrs.followedKeys()).toEqual(new Set(['acme/app#1']));
    expect(store.scoutedPrs.get('acme/app#2')).toMatchObject({ dismissReason: 'not our area' });
    expect(store.scoutedPrs.get('acme/app#3')).toMatchObject({ expiryReason: 'merged' });
    expect([...store.scoutedPrs.getMany(['acme/app#1', 'acme/app#9']).keys()]).toEqual(['acme/app#1']);
  });
});
