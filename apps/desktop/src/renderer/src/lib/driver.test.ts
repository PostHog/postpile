import { describe, expect, it } from 'vitest';
import { choiceHelper, choiceLabel, driverLabel } from './driver.ts';

describe('driverLabel', () => {
  it('names the driver as the header says it', () => {
    expect(driverLabel({ kind: 'you', login: 'alice' })).toBe('You drive');
    expect(driverLabel({ kind: 'person', login: 'lyra' })).toBe('lyra drives');
    expect(driverLabel({ kind: 'team', login: null })).toBe('Your team drives');
    expect(driverLabel({ kind: 'outside', login: null })).toBe('Someone outside your team drives');
    expect(driverLabel({ kind: null, login: null })).toBe('Who drives?');
  });
});

describe('choiceLabel and choiceHelper', () => {
  it('names each menu item, with a helper only for the team and someone outside', () => {
    expect([choiceLabel({ kind: 'you', login: 'alice' }), choiceHelper({ kind: 'you' })]).toEqual(['You', null]);
    expect([choiceLabel({ kind: 'person', login: 'lyra' }), choiceHelper({ kind: 'person' })]).toEqual(['lyra', null]);
    expect([choiceLabel({ kind: 'team', login: null }), choiceHelper({ kind: 'team' })]).toEqual(['Your team', 'Shared, no single driver']);
    expect([choiceLabel({ kind: 'outside', login: null }), choiceHelper({ kind: 'outside' })]).toEqual(['Someone outside your team', 'No name needed']);
  });
});
