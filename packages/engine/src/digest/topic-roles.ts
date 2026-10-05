import {
  driverLogin,
  isBot,
  TEAM_DRIVER,
  topicDriver,
  userRoleFor,
  type DossierVersion,
  type LightPr,
  type NotificationReason,
  type Pr,
  type PrKey,
  type Topic,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { DigestDeps } from './deps.ts';

/**
 * The dossier knows who drives the initiative: a person, or the user's team
 * (driverTeam, stored as TEAM_DRIVER). Without one, the most frequent author does.
 */
function driverOf(dossier: DossierVersion | undefined, prs: Array<Pick<Pr, 'author' | 'assignees'>>): string | null {
  if (dossier?.dossier.driverTeam) {
    return TEAM_DRIVER;
  }
  // A bot never drives a topic over the people it opened PRs for (`prOwners` via topicDriver).
  const fromDossier = dossier?.dossier.people.find((person) => person.role === 'driver' && !isBot(person.login))?.login;
  return fromDossier ?? topicDriver(prs);
}

/** Every stored PR's light row by key: owners without parsing a snapshot. */
function lightByKey(store: Store): Map<PrKey, LightPr> {
  return new Map(store.prs.listLight().map((pr) => [pr.key, pr]));
}

/**
 * Stores the topic's automatic driver and the user's role in it. The
 * user's driver pick (`pick`, its own table) is never written here; the
 * role reads it, so "You" makes the user the driver. Owners come from the
 * light rows (`light`), so a sync does not parse every topic's snapshots.
 */
export function refreshTopicDriverAndRole(
  store: Store,
  viewerLogin: string,
  topic: Topic,
  dossier: DossierVersion | undefined,
  pick: string | null,
  at: string,
  light: Map<PrKey, LightPr> = lightByKey(store),
): void {
  const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
  if (keys.length === 0) {
    return;
  }
  const prs = keys.flatMap((key) => light.get(key) ?? []);
  const reasons: NotificationReason[] = [...store.notifications.getByPrKeys(keys).values()].map((t) => t.reason);
  const driver = driverOf(dossier, prs);
  const role = userRoleFor(viewerLogin, driverLogin(pick ?? driver), reasons);
  if (driver !== topic.driver || role !== topic.userRole) {
    store.topics.setDriverAndRole(topic.id, driver, role, at);
  }
}

/** Driver and user role come from the dossier, PR authors, ping reasons and the user's driver picks, no agent call. */
export function refreshDriversAndRoles(deps: DigestDeps): void {
  const { store } = deps;
  const at = deps.now().toISOString();
  const topics = store.topics.listActive();
  const dossiers = store.dossiers.latestMany(topics.map((t) => t.id));
  const picks = store.driverPicks.all();
  const light = lightByKey(store);
  store.transaction(() => {
    for (const topic of topics) {
      refreshTopicDriverAndRole(store, deps.viewer.login, topic, dossiers.get(topic.id), picks.get(topic.id) ?? null, at, light);
    }
  });
}
