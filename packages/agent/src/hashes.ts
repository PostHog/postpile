import { isBot } from '@code-manager/core';
import type { Pr } from '@code-manager/core';
import { inputHash } from './hash.ts';
import { modelFor } from './models.ts';
import { humanComments } from './prompts/shared.ts';
import type { DossierUpdateInput, GlanceBatchInput, GlanceBatchItem, GlanceInput, SetGroupingInput, TopicSummaryInput } from './service.ts';

// Input hashes decide when a stored answer is stale. They cover what the
// answer depends on, not every byte of the prompt: a bot comment or a CI
// re-run must not regenerate a glance, so those are left out on purpose.

/** What a glance depends on: code, description, review state and human discussion. */
function prGlanceSnapshot(pr: Pr): unknown {
  return {
    key: pr.key,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    isDraft: pr.isDraft,
    headOid: pr.headOid,
    labels: pr.labels,
    reviewerUsers: pr.reviewerUsers,
    reviewerTeams: pr.reviewerTeams,
    reviews: pr.reviews.filter((r) => !isBot(r.author)).map((r) => [r.id, r.state]),
    comments: humanComments(pr).map((c) => c.id),
  };
}

/** What a topic summary depends on: which PRs are in it and roughly where each stands. */
function prSummarySnapshot(pr: Pr): unknown {
  return [pr.key, pr.title, pr.state, pr.isDraft];
}

/**
 * Only feedback about this PR goes into the glance hash. Feeding every topic
 * correction in would regenerate every glance in the topic on each click.
 */
export function glanceInputHash(input: GlanceInput): string {
  const ownFeedback = input.context.recentFeedback.filter((f) => f.prKey === input.pr.key).map((f) => f.id);
  return inputHash(
    'glance',
    modelFor('glance'),
    prGlanceSnapshot(input.pr),
    input.viewer,
    input.provenance,
    input.topic?.name ?? null,
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    ownFeedback,
  );
}

/** Feedback is in the summary prompt, so it is in the hash too. */
export function topicSummaryInputHash(input: TopicSummaryInput): string {
  const prs = [...input.prs].sort((a, b) => a.key.localeCompare(b.key)).map(prSummarySnapshot);
  return inputHash(
    'topic_summary',
    modelFor('topic_summary'),
    input.topic.name,
    prs,
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    input.context.recentFeedback.map((f) => f.id),
  );
}

/**
 * Sets regroup when membership, the user's set corrections (dissolved sets,
 * removed members) or any topic feedback changes. Active members are left
 * out on purpose: they are the agent's own last answer, and counting them
 * would make every regroup trigger the next one.
 */
export function setGroupingInputHash(input: SetGroupingInput): string {
  const prs = [...input.prs].sort((a, b) => a.key.localeCompare(b.key)).map((pr) => [pr.key, pr.title, pr.baseRef, pr.headRef]);
  const sets = input.existingSets
    .filter((s) => s.status === 'dissolved' || s.removedKeys.length > 0)
    .map((s) => [s.id, s.status === 'dissolved' ? s.members.map((m) => m.prKey) : [], s.removedKeys]);
  return inputHash(
    'set_grouping',
    modelFor('set_grouping'),
    input.topic.name,
    prs,
    sets,
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    input.context.recentFeedback.map((f) => f.id),
  );
}

/**
 * What a dossier update depends on: the previous version (topic + number),
 * the delta (event ids, toSeq, joined and left PRs, stale fact ids and
 * claims, new feedback ids), tailoring, standing rules, model and prompt
 * version. Not the instructions file (see DESIGN.md open questions) and not
 * knownFacts, which are context only.
 */
export function dossierInputHash(input: DossierUpdateInput): string {
  const delta = input.delta;
  return inputHash(
    'dossier_update',
    modelFor('dossier_update'),
    input.topic.id,
    input.previous?.version ?? 0,
    delta.events.map((e) => e.id),
    delta.toSeq,
    delta.joinedPrKeys,
    delta.leftPrKeys,
    input.staleFacts.map((f) => [f.id, f.text]),
    delta.staleClaims,
    delta.newFeedback.map((f) => f.id),
    input.context.tailoring,
    input.context.standingRules,
  );
}

/**
 * Per PR inside a batch: prGlanceSnapshot, provenance, topic name, dossier
 * version, instructions, tailoring, standing rules, feedback on this PR,
 * model. Never the other PRs in the batch, so batch composition cannot
 * invalidate a glance.
 */
export function glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
  const ownFeedback = input.context.recentFeedback.filter((f) => f.prKey === item.pr.key).map((f) => f.id);
  const dossier = input.dossier ? [input.dossier.topicId, input.dossier.version] : null;
  return inputHash(
    'glance_batch',
    modelFor('glance_batch'),
    prGlanceSnapshot(item.pr),
    input.viewer,
    item.provenance,
    input.topic?.name ?? null,
    dossier,
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    ownFeedback,
  );
}
