import { describe, expect, it } from 'vitest';
import { ownerLine, ownerLineText } from './owner-line.ts';

describe('ownerLine', () => {
  it('says who owns the topic while nobody is known to drive', () => {
    expect(ownerLine('acme/team-platform', null)).toEqual({ before: 'Owned by ', team: 'acme/team-platform' });
    expect(ownerLine('acme/team-platform', { kind: null, login: null, driverDecides: false })).toEqual({ before: 'Owned by ', team: 'acme/team-platform' });
    expect(ownerLine(null, { kind: 'person', login: 'omar', driverDecides: true })).toEqual({ before: 'Owner not known', team: null });
  });

  // Owner, 2026-10-11 (BOARD-A-13): the driver decides the section, the owner team is only what usually holds.
  it('keeps "Owned by" when the driver puts the topic where the owner team would', () => {
    expect(ownerLineText(ownerLine('acme/team-platform', { kind: 'person', login: 'sol', driverDecides: false }))).toBe('Owned by acme/team-platform');
  });

  it('leads with the driver when the driver placed the topic', () => {
    expect(ownerLineText(ownerLine('acme/team-platform', { kind: 'person', login: 'omar', driverDecides: true }))).toBe('omar drives · usually team-platform');
    expect(ownerLineText(ownerLine('acme/team-platform', { kind: 'you', login: 'alice', driverDecides: true }))).toBe('You drive · usually team-platform');
    expect(ownerLineText(ownerLine('acme/team-platform', { kind: 'outside', login: null, driverDecides: true }))).toBe('Someone outside your team drives · usually team-platform');
  });
});
