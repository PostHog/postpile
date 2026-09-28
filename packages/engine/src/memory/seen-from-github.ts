import { seenBoundary, type IsoTime, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * Moves "since you last looked" forward for topics whose PRs were read on
 * github.com: the seen cursor goes up to the last event before the first
 * one still unseen. When the whole topic is caught up it also takes the
 * current dossier version and `at`, like markTopicSeen, so the dossier's
 * recent changes and new facts stop showing as new. Topics never marked
 * seen only get a cursor once caught up. Called after the sync's digest
 * and after a poll, with the PRs GitHub's read times touched.
 */
export function advanceSeenFromGitHub(store: Store, prKeys: PrKey[], at: IsoTime): void {
  const topicIds = new Set(prKeys.flatMap((key) => store.memberships.get(key)?.topicId ?? []));
  for (const topicId of topicIds) {
    const seen = store.cursors.get('seen', topicId);
    const fromSeq = seen?.seq ?? 0;
    const members = store.memberships.listForTopic(topicId).map((membership) => membership.prKey);
    const logged = store.eventLog.listSince(members, fromSeq).map((entry) => ({ seq: entry.seq, seen: entry.event.seenAt !== null }));
    const boundary = seenBoundary(logged, fromSeq);
    if (boundary.caughtUp) {
      const version = store.dossiers.latest(topicId)?.version ?? null;
      store.cursors.advance({ kind: 'seen', scope: topicId, seq: boundary.seq, dossierVersion: version, updatedAt: at });
    } else if (seen && boundary.seq > seen.seq) {
      store.cursors.advance({ ...seen, seq: boundary.seq });
    }
  }
}
