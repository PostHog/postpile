import { isBot, topicDriver, userRoleFor, type DossierVersion, type NotificationReason, type Pr } from '@postpile/core';
import type { DigestDeps } from './deps.ts';

/** The dossier knows who drives the initiative; without one, the most frequent author does. */
function driverOf(dossier: DossierVersion | undefined, prs: Pr[]): string | null {
  // A bot never drives a topic over the people it opened PRs for (`prOwners` via topicDriver).
  const fromDossier = dossier?.dossier.people.find((person) => person.role === 'driver' && !isBot(person.login))?.login;
  return fromDossier ?? topicDriver(prs);
}

/** Driver and user role come from the dossier, PR authors and ping reasons, no agent call. */
export function refreshDriversAndRoles(deps: DigestDeps): void {
  const { store } = deps;
  const at = deps.now().toISOString();
  const topics = store.topics.listActive();
  const dossiers = store.dossiers.latestMany(topics.map((t) => t.id));
  store.transaction(() => {
    for (const topic of topics) {
      const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
      if (keys.length === 0) {
        continue;
      }
      const prs = [...store.prs.getMany(keys).values()];
      const reasons: NotificationReason[] = [...store.notifications.getByPrKeys(keys).values()].map((t) => t.reason);
      const driver = driverOf(dossiers.get(topic.id), prs);
      const role = userRoleFor(deps.viewer.login, driver, reasons);
      if (driver !== topic.driver || role !== topic.userRole) {
        store.topics.setDriverAndRole(topic.id, driver, role, at);
      }
    }
  });
}
