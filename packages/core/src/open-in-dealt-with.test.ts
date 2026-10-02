import { describe, expect, it } from 'vitest';
import { openInDealtWith } from './open-in-dealt-with.ts';
import type { TileGroup } from './tile-groups.ts';
import type { PrKey, PrState, Provenance } from './types.ts';
import type { TileView } from './views.ts';

interface PrSample {
  key: PrKey;
  state: PrState;
  isDraft?: boolean;
  provenance?: Provenance;
}

const pinged: Provenance = { kind: 'pinged', reason: 'review_requested' };

function view(group: TileGroup, ...prs: PrSample[]): Pick<TileView, 'group' | 'prs'> {
  return {
    group,
    prs: prs.map((pr) => ({ isDraft: false, provenance: pinged, ...pr })) as Pick<TileView, 'prs'>['prs'],
  };
}

describe('openInDealtWith', () => {
  it('names open PRs that sit only in Dealt with tiles', () => {
    const result = openInDealtWith([
      view('dealt_with', { key: 'acme/devex-depot-tools#3', state: 'OPEN', isDraft: true }, { key: 'acme/app#1', state: 'MERGED' }),
      view('dealt_with', { key: 'acme/app#2', state: 'CLOSED' }),
    ]);
    expect(result).toEqual([{ key: 'acme/devex-depot-tools#3', label: 'devex-depot-tools#3', isDraft: true }]);
  });

  it('leaves out a PR that also sits in a tile that is not dealt with', () => {
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'OPEN' }), view('open', { key: 'acme/app#1', state: 'OPEN' })])).toEqual([]);
  });

  it('leaves out pulled-in stack layers, like the Archive gate', () => {
    const pulledIn: Provenance = { kind: 'pulled_in', reason: 'stack layer below acme/app#1' };
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'OPEN', provenance: pulledIn })])).toEqual([]);
  });

  it('is empty without open PRs, and lists a PR once', () => {
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'MERGED' })])).toEqual([]);
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'OPEN' }), view('dealt_with', { key: 'acme/app#1', state: 'OPEN' })])).toHaveLength(1);
  });
});
