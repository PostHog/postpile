// Open PRs in a topic whose tiles are all Dealt with. Tile state is about the
// user's move, PR state is about GitHub: a PR can be open and dealt with at
// once (the owner's own draft, a PR waiting on others). The topic then stays
// out of the Archive, and the header says why (DESIGN.md 2026-10-02 "Open
// PRs in Dealt with"). Core decides, the renderer only displays it.
import type { PrKey } from './types.ts';
import type { OpenInDealtWithPr, TileView } from './views.ts';

/** "repo#number" without the owner, for the hint's tooltip. */
function labelOf(key: PrKey): string {
  return key.slice(key.indexOf('/') + 1);
}

/**
 * The open PRs that sit only in Dealt with tiles, in tile order; empty when
 * there are none. A PR that also sits in an Unread or Open tile is left out:
 * that tile already shows it needs the user. Pulled-in stack layers are left
 * out too: they are not members of the topic, so the Archive gate
 * (`RetireGate.allPrsOver`) does not wait for them, and the hint must agree
 * with the gate.
 */
export function openInDealtWith(views: Pick<TileView, 'group' | 'prs'>[]): OpenInDealtWithPr[] {
  const outside = new Set<PrKey>(views.filter((view) => view.group !== 'dealt_with').flatMap((view) => view.prs.map((pr) => pr.key)));
  const open = views
    .filter((view) => view.group === 'dealt_with')
    .flatMap((view) => view.prs)
    .filter((pr) => pr.state === 'OPEN' && pr.provenance.kind !== 'pulled_in' && !outside.has(pr.key))
    .map((pr) => ({ key: pr.key, label: labelOf(pr.key), isDraft: pr.isDraft }));
  return [...new Map(open.map((pr) => [pr.key, pr])).values()];
}
