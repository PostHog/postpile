import { driverPickRefusal, type ActionResult } from '@postpile/core';
import type { Store } from '@postpile/store';
import { UNSORTED_TOPIC_ID } from '../board.ts';
import { refreshTopicDriverAndRole } from '../digest/topic-roles.ts';
import { loadViewer } from '../viewer-meta.ts';
import { failed, ok } from './results.ts';

/**
 * The header's driver menu (DESIGN "Driver picker"): `driver` is one of the
 * menu's values (the viewer, a teammate, TEAM_DRIVER, OUTSIDE_DRIVER), null
 * resets to automatic. The pick stands until the user changes it; syncs
 * keep refreshing the automatic driver beside it. The user's role follows
 * at once. Local only, never a GitHub write.
 */
export function setTopicDriver(store: Store, topicId: string, driver: string | null, at: string): ActionResult {
  const topic = topicId === UNSORTED_TOPIC_ID ? null : store.topics.get(topicId);
  if (!topic) {
    return failed(`no topic ${topicId}`);
  }
  const viewer = loadViewer(store);
  const refusal = driverPickRefusal(driver, viewer);
  if (refusal !== null) {
    return failed(refusal);
  }
  store.transaction(() => {
    if (driver === null) {
      store.driverPicks.clear(topicId);
    } else {
      store.driverPicks.set(topicId, driver, at);
    }
    if (viewer) {
      refreshTopicDriverAndRole(store, viewer.login, topic, store.dossiers.latest(topicId) ?? undefined, driver, at);
    }
  });
  return ok(driver === null ? 'Back to the automatic driver' : 'Driver set');
}
