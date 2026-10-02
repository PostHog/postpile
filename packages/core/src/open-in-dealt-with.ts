// Open PRs in a topic whose tiles are all Dealt with. Tile state is about the
// user's move, PR state is about GitHub: a PR can be open and dealt with at
// once (the owner's own draft, a PR waiting on others). The topic then stays
// out of the Archive, and the header says why (DESIGN.md 2026-10-02 "Open
// PRs in Dealt with"). Core decides, the renderer only displays it.
import { parsePrKey } from './keys.ts';
import type { PrKey } from './types.ts';
import type { OpenInDealtWith, TileView } from './views.ts';

/**
 * The open PRs that sit only in Dealt with tiles, in tile order; null when
 * there are none. A PR that also sits in an Unread or Open tile is left out:
 * that tile already shows it needs the user.
 */
export function openInDealtWith(views: Pick<TileView, 'group' | 'prs'>[]): OpenInDealtWith | null {
  const outside = new Set<PrKey>();
  for (const view of views) {
    if (view.group !== 'dealt_with') {
      view.prs.forEach((pr) => outside.add(pr.key));
    }
  }
  const found = new Map<PrKey, OpenInDealtWith['prs'][number]>();
  for (const view of views) {
    for (const pr of view.prs) {
      if (view.group !== 'dealt_with' || pr.state !== 'OPEN' || outside.has(pr.key) || found.has(pr.key)) {
        continue;
      }
      const { repo, number } = parsePrKey(pr.key);
      found.set(pr.key, { key: pr.key, number, repo, label: `${repo.split('/').pop()}#${number}`, isDraft: pr.isDraft, author: pr.author });
    }
  }
  return found.size === 0 ? null : { count: found.size, prs: [...found.values()] };
}
