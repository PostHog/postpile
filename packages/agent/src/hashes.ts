import { isBot, standingApprovals } from '@postpile/core';
import type { Pr } from '@postpile/core';
import { inputHash } from './hash.ts';
import { modelFor } from './models.ts';
import { humanComments } from './prompts/shared.ts';
import type { DossierUpdateInput, GlanceBatchInput, GlanceBatchItem, PromptContext, SetGroupingInput } from './service.ts';

/**
 * Wording version of the dossier update prompt alone. d2 asks every line
 * for its sources. Only the stored input hash records it: bumping the
 * shared PROMPT_VERSION would regenerate every glance and set for nothing,
 * and older dossiers read fine, their lines show "no source recorded".
 */
export const DOSSIER_PROMPT_VERSION = 'd2';

/**
 * Wording version of the glance batch prompt alone, like
 * DOSSIER_PROMPT_VERSION. g2 asks for keyFiles, so every glance regenerates
 * once to get them; sets and topic summaries stay as they are.
 */
export const GLANCE_PROMPT_VERSION = 'g2';

// Input hashes decide when a stored answer is stale. They cover what the
// answer depends on, not every byte of the prompt: a bot comment or a CI
// re-run must not regenerate a glance, so those are left out on purpose.

/**
 * What a glance depends on: code, description, review state and human
 * discussion. Agent approvals are in the prompt ("Approved by"), so they
 * count too; the key is only added when there are some, so hashes of PRs
 * without them stayed the same when it came in.
 */
function prGlanceSnapshot(pr: Pr): unknown {
  const agentApprovals = standingApprovals(pr).agents;
  const snapshot = {
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
  return agentApprovals.length > 0 ? { ...snapshot, agentApprovals } : snapshot;
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
 * The parts of the user's context a dossier's userCares are written from.
 * The engine keeps it per topic; a change refreshes the dossier even when no
 * new event arrived, so glances are not written from outdated cares.
 */
export function dossierContextHash(context: PromptContext): string {
  return inputHash('dossier_context', context.instructions, context.tailoring, context.standingRules);
}

/**
 * A record of what a dossier version was written from, stored with it: the
 * previous version (topic + number), the delta (event ids, toSeq, joined and
 * left PRs, stale fact ids and claims, new feedback ids), instructions,
 * tailoring, standing rules, chat turn ids, model and prompt versions. Not knownFacts, which
 * are context only. Nothing skips a call on it: whether to update is
 * isEmptyDelta plus dossierContextHash.
 */
export function dossierInputHash(input: DossierUpdateInput): string {
  const delta = input.delta;
  return inputHash(
    'dossier_update',
    DOSSIER_PROMPT_VERSION,
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
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    input.chatTurns.map((message) => message.id),
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
    GLANCE_PROMPT_VERSION,
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
