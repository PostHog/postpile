import { isBot } from '@code-manager/core';
import type { Pr } from '@code-manager/core';
import { inputHash } from './hash.ts';
import { modelFor } from './models.ts';
import { humanComments } from './prompts/shared.ts';
import type { GlanceInput, SetGroupingInput, TopicSummaryInput } from './service.ts';

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
    checks: pr.checks.rollup,
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
    ownFeedback,
  );
}

export function topicSummaryInputHash(input: TopicSummaryInput): string {
  const prs = [...input.prs].sort((a, b) => a.key.localeCompare(b.key)).map(prSummarySnapshot);
  return inputHash(
    'topic_summary',
    modelFor('topic_summary'),
    input.topic.name,
    prs,
    input.context.instructions,
    input.context.tailoring,
  );
}

/**
 * Sets regroup when membership, dissolved sets or any topic feedback changes.
 * Active sets are left out on purpose: they are the agent's own last answer,
 * and counting them would make every regroup trigger the next one.
 */
export function setGroupingInputHash(input: SetGroupingInput): string {
  const prs = [...input.prs].sort((a, b) => a.key.localeCompare(b.key)).map((pr) => [pr.key, pr.title, pr.baseRef, pr.headRef]);
  const sets = input.existingSets
    .filter((s) => s.status === 'dissolved')
    .map((s) => [s.id, s.members.map((m) => m.prKey)]);
  return inputHash(
    'set_grouping',
    modelFor('set_grouping'),
    input.topic.name,
    prs,
    sets,
    input.context.instructions,
    input.context.tailoring,
    input.context.recentFeedback.map((f) => f.id),
  );
}
