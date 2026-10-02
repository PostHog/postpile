import { describe, expect, it } from 'vitest';
import { openInDealtWith } from './open-in-dealt-with.ts';
import type { TileGroup } from './tile-groups.ts';
import type { PrState } from './types.ts';
import type { TileView } from './views.ts';

function view(group: TileGroup, ...prs: { key: string; state: PrState; isDraft?: boolean }[]): Pick<TileView, 'group' | 'prs'> {
  return { group, prs: prs.map((pr) => ({ author: 'julian', isDraft: false, ...pr })) as unknown as TileView['prs'] };
}

describe('openInDealtWith', () => {
  it('names open PRs that sit only in Dealt with tiles', () => {
    const result = openInDealtWith([
      view('dealt_with', { key: 'acme/devex-depot-tools#3', state: 'OPEN', isDraft: true }, { key: 'acme/app#1', state: 'MERGED' }),
      view('dealt_with', { key: 'acme/app#2', state: 'CLOSED' }),
    ]);
    expect(result).toEqual({
      count: 1,
      prs: [{ key: 'acme/devex-depot-tools#3', number: 3, repo: 'acme/devex-depot-tools', label: 'devex-depot-tools#3', isDraft: true, author: 'julian' }],
    });
  });

  it('leaves out a PR that also sits in a tile that is not dealt with', () => {
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'OPEN' }), view('open', { key: 'acme/app#1', state: 'OPEN' })])).toBeNull();
  });

  it('is null without open PRs, and counts a PR once', () => {
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'MERGED' })])).toBeNull();
    expect(openInDealtWith([view('dealt_with', { key: 'acme/app#1', state: 'OPEN' }), view('dealt_with', { key: 'acme/app#1', state: 'OPEN' })])?.count).toBe(1);
  });
});
