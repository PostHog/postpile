import {
  DOSSIER_HISTORY_SHOWN,
  dossierVersionNotes,
  topicChangesSince,
  verifyDossier,
  type DossierView,
  type FactQuery,
  type FactView,
  type Pr,
  type PrKey,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { factViews } from './fact-world.ts';

/** Enough recent topic feedback to find every correction made since the latest version. */
const FEEDBACK_SCANNED_FOR_CORRECTIONS = 50;

/**
 * Read models over engine memory: the topic dossier with what changed since
 * the user last looked, and facts. Verify-before-use runs here too, but only
 * to flag claims and facts as stale; reads never write.
 */
export class MemoryReads {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /** Lines the user marked wrong or asked to forget after `since`. */
  private correctedClaims(topicId: string, since: string): string[] {
    return this.store.feedback
      .recentForTopic(topicId, FEEDBACK_SCANNED_FOR_CORRECTIONS)
      .filter((entry) => (entry.kind === 'memory_wrong' || entry.kind === 'memory_forget') && entry.createdAt > since)
      .map((entry) => entry.note);
  }

  dossierView(topicId: string, prs: Map<PrKey, Pr>): DossierView | null {
    const { store } = this;
    const latest = store.dossiers.latest(topicId);
    if (!latest) {
      return null;
    }
    const memberKeys = store.memberships.listForTopic(topicId).map((m) => m.prKey);
    const world = { prs, memberKeys: new Set(memberKeys), now: this.now().toISOString() };
    const seen = store.cursors.get('seen', topicId);
    const changedFacts = seen ? store.facts.query({ topicId, changedSince: seen.updatedAt, includeClosed: true }) : [];
    const newEvents = seen ? store.eventLog.countSince(memberKeys, seen.seq) : 0;
    return {
      version: latest.version,
      createdAt: latest.createdAt,
      dossier: latest.dossier,
      flags: latest.flags,
      staleClaims: verifyDossier(latest.dossier, world),
      changesSinceSeen: topicChangesSince(seen, latest, changedFacts, newEvents),
      eventsBehind: store.eventLog.countSince(memberKeys, latest.throughSeq),
      // One extra version, so the oldest shown one has something to compare against.
      history: dossierVersionNotes(store.dossiers.listVersions(topicId, DOSSIER_HISTORY_SHOWN + 1)),
      correctedClaims: this.correctedClaims(topicId, latest.createdAt),
    };
  }

  /** Active facts about the PR or citing it. */
  prFacts(key: PrKey): FactView[] {
    return factViews(this.store, this.store.facts.listActiveTouchingPrs([key]), this.now().toISOString());
  }

  listFacts(query: FactQuery): FactView[] {
    return factViews(this.store, this.store.facts.query(query), this.now().toISOString());
  }
}
