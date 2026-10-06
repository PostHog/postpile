import { glanceRiskLevel, humanReviews, isBot, isMachineComment, prOwners, standingApprovals } from '@postpile/core';
import type { Comment, IsoTime, Pr, Review } from '@postpile/core';
import { inputHash } from './hash.ts';
import { modelFor } from './models.ts';
import { humanComments } from './prompts/shared.ts';
import { activeSets, unplacedKeys } from './set-answer.ts';
import type { DossierUpdateInput, GlanceBatchInput, GlanceBatchItem, PromptContext, SetGroupingInput } from './service.ts';

/**
 * Wording version of the dossier update prompt alone. d2 asks every line
 * for its sources. Only the stored input hash records it: bumping the
 * shared PROMPT_VERSION would regenerate every glance and set for nothing,
 * and older dossiers read fine, their lines show "no source recorded".
 * Dropping CI (NO_CI_RULE, 2026-09-29) kept d2: a dossier is rewritten on
 * the topic's next real activity anyway. So did fencing the area names
 * (2026-09-29): the same data, only moved inside <github_data>. So did
 * driverTeam and the user's driver pick (2026-10-02): picked up at each
 * topic's next dossier update.
 */
export const DOSSIER_PROMPT_VERSION = 'd2';

/**
 * Wording version of the glance batch prompt alone, like
 * DOSSIER_PROMPT_VERSION. g2 asks for keyFiles, so every glance regenerates
 * once to get them; sets and topic summaries stay as they are. Dropping CI
 * (NO_CI_RULE, 2026-09-29) kept g2: a glance that talks about CI goes stale
 * on the PR's next push, review or human comment, so no mass regeneration.
 */
export const GLANCE_PROMPT_VERSION = 'g2';

// Input hashes decide when a stored answer is stale. They cover what the
// answer depends on, not every byte of the prompt: a bot comment must not
// regenerate a glance, so those are left out on purpose. Checks are not in
// any prompt (NO_CI_RULE) and stay out of every hash too.

/** The discussion a glance hash covers: people's comments and reviews. */
interface GlanceDiscussion {
  comments: Comment[];
  reviews: Review[];
}

/**
 * The discussion a glance reads since 2026-10-06: no bot talk (a bot's
 * comment, a reply in a bot-only thread, "@codex review"), no bot's review
 * and no empty review GitHub made to carry thread replies. Bot talk was
 * most of what counted before, and each one re-ran the glance.
 */
function humanGlanceDiscussion(pr: Pr): GlanceDiscussion {
  return { comments: humanComments(pr), reviews: humanReviews(pr) };
}

/**
 * The discussion the glance hash covered before 2026-10-06 (every comment
 * and review but a bot's), as it stood when a glance was written at
 * `writtenAt`: bot talk and carrier reviews that came later are left out.
 * Under the old shape they would have changed the hash, under the new one
 * they don't, so a glance written before the update stays current until
 * its PR really changes, instead of every PR with bot talk re-running its
 * glance on the update (DESIGN.md "Bot talk leaves agent work" › Glances written before).
 */
function glanceDiscussionWithBotTalk(pr: Pr, writtenAt: IsoTime): GlanceDiscussion {
  const human = humanGlanceDiscussion(pr);
  const humanComment = new Set(human.comments.map((comment) => comment.id));
  const humanReview = new Set(human.reviews.map((review) => review.id));
  return {
    comments: pr.comments.filter((comment) => !isMachineComment(comment) && (humanComment.has(comment.id) || comment.createdAt <= writtenAt)),
    reviews: pr.reviews.filter((review) => !isBot(review.author) && (humanReview.has(review.id) || review.submittedAt <= writtenAt)),
  };
}

/**
 * What a glance depends on: code, description, review state and human
 * discussion. Agent approvals are in the prompt ("Approved by"), so they
 * count too; the key is only added when there are some, so hashes of PRs
 * without them stayed the same when it came in.
 */
function prGlanceSnapshot(pr: Pr, discussion: GlanceDiscussion): unknown {
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
    reviews: discussion.reviews.map((r) => [r.id, r.state]),
    comments: discussion.comments.map((c) => c.id),
  };
  // Owners change the prompt (own-PR note, "for @owner"). Only added when they differ from the author, so older hashes stay valid.
  const owners = prOwners(pr);
  const withOwners = owners.length === 1 && owners[0] === pr.author ? snapshot : { ...snapshot, owners };
  return agentApprovals.length > 0 ? { ...withOwners, agentApprovals } : withOwners;
}

/**
 * Wording version of the set prompt alone, like DOSSIER_PROMPT_VERSION. s2:
 * sets as lasting tiles one judgement covers, answered as changes only
 * (2026-10-01). Part of the context trigger, so every topic regroups once.
 */
export const SET_PROMPT_VERSION = 's2';

/**
 * What a set regroup reacts to, one string per fact. The engine runs a
 * regroup only when a fact shows up that the last run did not see: an open
 * PR to place, a PR whose risk level changed, a new correction, a dissolved
 * set, changed instructions or prompt. A PR that merges or leaves only takes
 * facts away, so it never triggers one: sets do not move on status.
 */
export function setGroupingTriggers(input: SetGroupingInput): string[] {
  const context = inputHash(
    'set_grouping',
    SET_PROMPT_VERSION,
    modelFor('set_grouping'),
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
  );
  const triggers = [`context:${context}`];
  for (const key of unplacedKeys(input)) {
    triggers.push(`open:${key}:${glanceRiskLevel(input.risks[key] ?? '')}`);
  }
  for (const set of activeSets(input)) {
    for (const member of set.members) {
      triggers.push(`member:${set.id}:${member.prKey}:${glanceRiskLevel(input.risks[member.prKey] ?? '')}`);
    }
  }
  for (const set of input.existingSets) {
    if (set.status === 'dissolved') {
      triggers.push(`dissolved:${set.id}`);
    }
    for (const key of set.removedKeys) {
      triggers.push(`removed:${set.id}:${key}`);
    }
  }
  for (const feedback of input.context.recentFeedback) {
    triggers.push(`feedback:${feedback.id}`);
  }
  return triggers;
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
    input.driverPick,
  );
}

/** The glance hash's shape since 2026-10-05, over the given discussion. */
function glanceHash(input: GlanceBatchInput, item: GlanceBatchItem, discussion: GlanceDiscussion): string {
  const ownFeedback = input.context.recentFeedback.filter((f) => f.prKey === item.pr.key).map((f) => f.id);
  // An edited comment's new body is in the prompt. The dossier version used to cover it (a person's edit
  // rewrote the dossier); without it the edit time does. Not in prGlanceSnapshot: the legacy hash must stay as it was.
  const commentEdits = discussion.comments
    .filter((comment) => comment.lastEditedAt)
    .map((comment) => [comment.id, comment.lastEditedAt]);
  return inputHash(
    'glance_batch',
    GLANCE_PROMPT_VERSION,
    modelFor('glance_batch'),
    prGlanceSnapshot(item.pr, discussion),
    input.viewer,
    item.provenance,
    input.topic?.name ?? null,
    input.context.instructions,
    input.context.tailoring,
    input.context.standingRules,
    ownFeedback,
    commentEdits,
  );
}

/**
 * Per PR inside a batch: prGlanceSnapshot, provenance, topic name,
 * instructions, tailoring, standing rules, feedback on this PR, when a
 * human comment was last edited, model. Bot talk is left out
 * (`humanGlanceDiscussion`), so a "fixed" to a review bot or an "@codex
 * review" never re-runs a glance.
 * Never the other PRs in the batch, so batch composition cannot invalidate
 * a glance. Not the dossier version (2026-10-05): a dossier rewrite for
 * news on another PR left every glance in the topic out of date. A glance
 * picks up the newer dossier when its own PR changes or on a look.
 */
export function glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
  return glanceHash(input, item, humanGlanceDiscussion(item.pr));
}

/**
 * The hash glances written from 2026-10-05 until 2026-10-06 carry: bot talk
 * counted as discussion, as it stood at `writtenAt` (the glance's
 * createdAt). A stored glance with it still counts as current, so the
 * update regenerates nothing; its next rewrite stores the new shape.
 */
export function glanceItemInputHashWithBotTalk(input: GlanceBatchInput, item: GlanceBatchItem, writtenAt: IsoTime): string {
  return glanceHash(input, item, glanceDiscussionWithBotTalk(item.pr, writtenAt));
}

/**
 * The hash glances carried before 2026-10-05, with the dossier version and
 * bot talk counted as discussion as it stood at `writtenAt` (the glance's
 * createdAt). A stored glance with it still counts as current while that
 * dossier is the latest, so the update regenerates nothing; its next
 * rewrite stores the new shape.
 */
export function legacyGlanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem, writtenAt: IsoTime): string {
  const ownFeedback = input.context.recentFeedback.filter((f) => f.prKey === item.pr.key).map((f) => f.id);
  const dossier = input.dossier ? [input.dossier.topicId, input.dossier.version] : null;
  return inputHash(
    'glance_batch',
    GLANCE_PROMPT_VERSION,
    modelFor('glance_batch'),
    prGlanceSnapshot(item.pr, glanceDiscussionWithBotTalk(item.pr, writtenAt)),
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
