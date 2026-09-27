import type { NotificationReason } from '@code-manager/core';
import { topicDriver, userRoleFor } from '../topic-roles.ts';
import type { DigestDeps } from './deps.ts';

/** Driver and user role come from PR authors and ping reasons, no agent needed. */
export function refreshDriversAndRoles(deps: DigestDeps): void {
  const { store } = deps;
  const at = deps.now().toISOString();
  store.transaction(() => {
    for (const topic of store.topics.listActive()) {
      const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
      if (keys.length === 0) {
        continue;
      }
      const prs = [...store.prs.getMany(keys).values()];
      const reasons: NotificationReason[] = [...store.notifications.getByPrKeys(keys).values()].map((t) => t.reason);
      const driver = topicDriver(prs);
      const role = userRoleFor(deps.viewer.login, driver, reasons);
      if (driver !== topic.driver || role !== topic.userRole) {
        store.topics.setDriverAndRole(topic.id, driver, role, at);
      }
    }
  });
}
