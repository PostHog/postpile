import type { DossierVersion, Pr, PrKey } from '@code-manager/core';

/**
 * The dossier as prompt text. PR state, author and CI come from `prs` (the
 * current snapshots), never from the stored dossier, so a prompt cannot
 * carry a stale state line. Stays under ~8k chars given DOSSIER_LIMITS.
 * Layout in DESIGN.md "Dossier as prompt text".
 */
export function renderDossier(version: DossierVersion, prs: Map<PrKey, Pr>): string {
  throw new Error(`not implemented: renderDossier (${version.topicId} v${version.version}, ${prs.size} prs)`);
}
