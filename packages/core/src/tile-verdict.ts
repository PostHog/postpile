// The tile's verdict pill: which PR's glance it shows. Its own module, so
// the tile view and the offers ("Not mine" stays out of the menu while the
// pill says Not yours) both read it.
import type { PrKey } from './types.ts';
import type { PrSummary, TileVerdict } from './views.ts';

/** What the pill reads of a row. */
export type VerdictRow = Pick<PrSummary, 'key' | 'provenance' | 'state' | 'verdict' | 'glanceStale' | 'glanceGap' | 'glanceState' | 'glanceRefreshBlock'>;

/**
 * How much a row's glance asks for a closer look, lowest first: Look
 * closer, then no current glance (missing, stale or being written), then
 * Looks safe, then Not yours. A stale Look closer still says Look closer.
 */
function verdictRank(pr: VerdictRow): number {
  if (pr.verdict === 'LOOK_CLOSER') {
    return 0;
  }
  if (pr.verdict === null || pr.glanceStale) {
    return 1;
  }
  return pr.verdict === 'LOOKS_SAFE' ? 2 : 3;
}

function tileVerdictOf(pr: VerdictRow): TileVerdict {
  return { prKey: pr.key, verdict: pr.verdict, glanceStale: pr.glanceStale, glanceGap: pr.glanceGap, glanceState: pr.glanceState, glanceRefreshBlock: pr.glanceRefreshBlock };
}

/**
 * The glance the tile's verdict pill shows (2026-10-01): the worst one among
 * the tile's open tracked PRs, so a stack whose lead looks safe but whose
 * third layer needs a look says Look closer, without the user picking out
 * that layer. Ties go to the lead PR, then tile order. With no open tracked
 * PR (all merged or closed) it is the lead PR's glance, as before.
 */
export function tileVerdict(prs: VerdictRow[], leadPrKey: PrKey | null): TileVerdict | null {
  const lead = prs.find((pr) => pr.key === leadPrKey) ?? null;
  const open = prs.filter((pr) => pr.provenance.kind !== 'pulled_in' && pr.state === 'OPEN');
  if (open.length === 0) {
    return lead ? tileVerdictOf(lead) : null;
  }
  // Start from the lead, so it wins a tie; a strictly worse row replaces it.
  let worst = lead && open.includes(lead) ? lead : open[0]!;
  for (const pr of open) {
    if (verdictRank(pr) < verdictRank(worst)) {
      worst = pr;
    }
  }
  return tileVerdictOf(worst);
}
