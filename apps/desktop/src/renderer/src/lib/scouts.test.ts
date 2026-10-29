import { describe, expect, it } from 'vitest';
import type { ScoutedPrView, ScoutListItem, TileScout } from '@postpile/core';
import { followStateText, followTitle, isScoutTopicId, scoutCountTitle, scoutedStateText, scoutRowTitle, scoutSeenTarget, scoutTilePrKey } from './scouts.ts';

const scout = (overrides: Partial<TileScout> = {}): TileScout => ({
  scoutId: 'lookout',
  scoutName: 'Lookout',
  reason: 'adds services/',
  unseen: true,
  prKeys: ['acme/app#1', 'acme/app#2'],
  follow: null,
  ...overrides,
});

const scouted = (overrides: Partial<ScoutedPrView> = {}): ScoutedPrView => ({
  scoutId: 'lookout',
  scoutName: 'Lookout',
  reason: 'adds services/',
  pulledAt: '2026-10-01T10:00:00Z',
  active: true,
  followedAt: null,
  dismissedAt: null,
  dismissReason: null,
  expiredAt: null,
  expiryReason: null,
  unseen: false,
  tracked: false,
  follow: null,
  ...overrides,
});

const item = (tiles: number, unseen: number): ScoutListItem => ({ id: 'lookout', topicId: 'scout:lookout', name: 'Lookout', tiles, unseen });

describe('isScoutTopicId', () => {
  it('tells a scout pseudo-topic from a topic', () => {
    expect(isScoutTopicId('scout:lookout')).toBe(true);
    expect(isScoutTopicId('topic-depot')).toBe(false);
    expect(isScoutTopicId(null)).toBe(false);
  });
});

describe('scout row words', () => {
  it('says what the count counts and that the PRs are outside the inbox', () => {
    expect(scoutCountTitle(item(4, 2))).toBe('2 of 4 tiles not seen in PostPile yet');
    expect(scoutRowTitle(item(1, 0))).toBe('Lookout: 1 tile from outside your GitHub inbox');
    expect(scoutRowTitle(item(0, 0))).toBe('Lookout: nothing pulled in right now');
  });
});

describe('followStateText', () => {
  it('words a pending or failed Follow and leaves a queued one to the toast', () => {
    expect(followStateText('pending')).toBe('Follow pending: unlock GitHub writes');
    expect(followStateText('failed')).toBe('Follow failed, send it from the lock');
    expect(followStateText('queued')).toBeNull();
    expect(followStateText(null)).toBeNull();
  });
});

describe('followTitle', () => {
  it('says the Follow waits in the lock while writes are locked', () => {
    expect(followTitle({ enabled: false, forcedOffReason: null, pending: [] })).toMatch(/pending write/);
    expect(followTitle({ enabled: true, forcedOffReason: null, pending: [] })).toMatch(/after 6s/);
  });
});

describe('scoutTilePrKey', () => {
  it('acts on the PR open in the pane, else the first scouted PR', () => {
    expect(scoutTilePrKey({ scout: scout() }, 'acme/app#2')).toBe('acme/app#2');
    expect(scoutTilePrKey({ scout: scout() }, 'acme/app#9')).toBe('acme/app#1');
    expect(scoutTilePrKey({ scout: scout() }, null)).toBe('acme/app#1');
    expect(scoutTilePrKey({}, null)).toBeNull();
  });
});

describe('scoutSeenTarget', () => {
  it('marks a scouted PR of an unseen scout tile, nothing else', () => {
    expect(scoutSeenTarget({ scout: scout() }, 'acme/app#2')).toBe('acme/app#2');
    expect(scoutSeenTarget({ scout: scout({ unseen: false }) }, 'acme/app#2')).toBeNull();
    expect(scoutSeenTarget({ scout: scout() }, 'acme/app#9')).toBeNull();
    expect(scoutSeenTarget({}, 'acme/app#1')).toBeNull();
    expect(scoutSeenTarget(null, 'acme/app#1')).toBeNull();
    expect(scoutSeenTarget({ scout: scout() }, null)).toBeNull();
  });
});

describe('scoutedStateText', () => {
  it('says where a scouted PR stands, followed first', () => {
    expect(scoutedStateText(scouted({ followedAt: '2026-10-02T10:00:00Z', tracked: true }))).toBe('You follow it on GitHub.');
    expect(scoutedStateText(scouted({ tracked: true }))).toBe('It reached your GitHub inbox since.');
    expect(scoutedStateText(scouted({ dismissedAt: '2026-10-02T10:00:00Z', dismissReason: 'known' }))).toBe('Dismissed: known');
    expect(scoutedStateText(scouted({ dismissedAt: '2026-10-02T10:00:00Z' }))).toBe('Dismissed.');
    expect(scoutedStateText(scouted({ expiredAt: '2026-10-02T10:00:00Z', expiryReason: 'merged' }))).toBe('Off the Scouted section: it merged.');
    expect(scoutedStateText(scouted({ follow: 'failed' }))).toBe('Follow failed, send it from the lock.');
    expect(scoutedStateText(scouted())).toBe('Not in your GitHub inbox.');
  });
});
