import type { TileStack } from '@postpile/core';
import { prNumber } from './tiles.ts';

/** Where one PR sits in a GitHub stack: layer 1 is the bottom (closest to the default branch). */
export interface StackPlace {
  layer: number;
  of: number;
  /** The PR this layer is built on; null for the bottom layer. */
  builtOn: string | null;
}

/**
 * Each stacked PR's place, by PR key, from a tile's `stacks` (bottom first).
 * Lone PRs are not in the map, so they get no stack mark.
 */
export function stackPlaces(stacks: TileStack[]): Map<string, StackPlace> {
  const places = new Map<string, StackPlace>();
  for (const stack of stacks) {
    if (stack.prKeys.length < 2) {
      continue;
    }
    stack.prKeys.forEach((prKey, index) => {
      places.set(prKey, { layer: index + 1, of: stack.prKeys.length, builtOn: stack.prKeys[index - 1] ?? null });
    });
  }
  return places;
}

/** "1/3", the text on the stack mark. */
export function stackPlaceLabel(place: StackPlace): string {
  return `${place.layer}/${place.of}`;
}

/** "Layer 2 of 3 in a stack (built on #1862)", or "(bottom of the stack)" for layer 1. */
export function stackPlaceTitle(place: StackPlace): string {
  const where = place.builtOn ? `built on #${prNumber(place.builtOn)}` : 'bottom of the stack';
  return `Layer ${place.layer} of ${place.of} in a stack (${where})`;
}
