import { topicPlacement, type DossierVersion, type RelationOverride, type Topic, type TopicPlacement } from '@postpile/core';
import type { Store } from '@postpile/store';

/** Meta key of the relation the user set with "Wrong" (RelationOverride JSON). */
export function relationOverrideKey(topicId: string): string {
  return `relation_override:${topicId}`;
}

export function readRelationOverride(store: Store, topicId: string): RelationOverride | null {
  const raw = store.meta.get(relationOverrideKey(topicId));
  return raw === null ? null : (JSON.parse(raw) as RelationOverride);
}

/** Relation, owner, why-you and area of a topic, with the user's correction applied while no new events arrived. */
export function placementOf(store: Store, topic: Topic, latest: DossierVersion | undefined): TopicPlacement | null {
  const override = readRelationOverride(store, topic.id);
  const eventsSince =
    override === null ? 0 : store.eventLog.countSince(store.memberships.listForTopic(topic.id).map((m) => m.prKey), override.seq);
  return topicPlacement(latest?.dossier.relation, topic.area, override, eventsSince);
}
