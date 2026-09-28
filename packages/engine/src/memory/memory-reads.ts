import {
  DOSSIER_HISTORY_SHOWN,
  dossierVersionNotes,
  parseFixedClaimNote,
  seenSinceBaseline,
  topicChangesSince,
  verifyDossier,
  type DossierView,
  type FactQuery,
  type FactView,
  type Feedback,
  type FixedClaim,
  type Pr,
  type PrKey,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadBaseline } from '../baseline-meta.ts';
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

  /** Corrections logged for the topic after `since`, newest first. */
  private correctionsSince(topicId: string, since: string): Feedback[] {
    return this.store.feedback.recentForTopic(topicId, FEEDBACK_SCANNED_FOR_CORRECTIONS).filter((entry) => entry.createdAt > since);
  }

  /** Lines the user marked wrong or asked to forget after `since`. */
  private correctedClaims(corrections: Feedback[]): string[] {
    return corrections.filter((entry) => entry.kind === 'memory_wrong' || entry.kind === 'memory_forget').map((entry) => entry.note);
  }

  /** Lines the user replaced with a recheck's fix after `since`. */
  private fixedClaims(corrections: Feedback[]): FixedClaim[] {
    return corrections
      .filter((entry) => entry.kind === 'memory_fixed')
      .map((entry) => parseFixedClaimNote(entry.note))
      .filter((claim) => claim !== null);
  }

  dossierView(topicId: string, prs: Map<PrKey, Pr>): DossierView | null {
    const { store } = this;
    const latest = store.dossiers.latest(topicId);
    if (!latest) {
      return null;
    }
    const memberKeys = store.memberships.listForTopic(topicId).map((m) => m.prKey);
    const world = { prs, memberKeys: new Set(memberKeys), now: this.now().toISOString() };
    const seen = seenSinceBaseline(store.cursors.get('seen', topicId), topicId, loadBaseline(store));
    const changedFacts = seen ? store.facts.query({ topicId, changedSince: seen.updatedAt, includeClosed: true }) : [];
    const newEvents = seen ? store.eventLog.countSince(memberKeys, seen.seq, loadBaseline(store)) : 0;
    const corrections = this.correctionsSince(topicId, latest.createdAt);
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
      correctedClaims: this.correctedClaims(corrections),
      fixedClaims: this.fixedClaims(corrections),
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
