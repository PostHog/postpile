import { describe, expect, it } from 'vitest';
import { stackPlaceLabel, stackPlaces, stackPlaceTitle } from './stacks.ts';

describe('stackPlaces', () => {
  const stack = { id: 'stack:acme/app#1', prKeys: ['acme/app#1', 'acme/app#2', 'acme/app#3'] };

  it('numbers layers from the bottom and names the layer below', () => {
    const places = stackPlaces([stack]);
    expect(places.get('acme/app#1')).toEqual({ layer: 1, of: 3, builtOn: null });
    expect(places.get('acme/app#3')).toEqual({ layer: 3, of: 3, builtOn: 'acme/app#2' });
  });

  it('leaves lone PRs and one-PR stacks out', () => {
    const places = stackPlaces([stack, { id: 'stack:acme/app#9', prKeys: ['acme/app#9'] }]);
    expect(places.has('acme/app#4')).toBe(false);
    expect(places.has('acme/app#9')).toBe(false);
  });

  it('handles several stacks in one set', () => {
    const places = stackPlaces([stack, { id: 'stack:acme/app#7', prKeys: ['acme/app#7', 'acme/app#8'] }]);
    expect(places.get('acme/app#8')).toEqual({ layer: 2, of: 2, builtOn: 'acme/app#7' });
    expect(places.size).toBe(5);
  });
});

describe('stack mark text', () => {
  it('shows the position and says what the layer is built on', () => {
    expect(stackPlaceLabel({ layer: 1, of: 3, builtOn: null })).toBe('1/3');
    expect(stackPlaceTitle({ layer: 1, of: 3, builtOn: null })).toBe('Layer 1 of 3 in a stack (bottom of the stack)');
    expect(stackPlaceTitle({ layer: 2, of: 3, builtOn: 'acme/app#1862' })).toBe('Layer 2 of 3 in a stack (built on #1862)');
  });
});
