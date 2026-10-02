import { isJunkReason, isSizeOrStateOnlyMergeReason, ruleHasWordedEvidence, ruleTextKey } from '@postpile/core';
import type { z } from 'zod';
import type { consolidationOutput } from './schemas.ts';
import type { AreaMerge, ConsolidationInput, ConsolidationResult, ConsolidationTopicProposal, FactMerge, RuleIdea } from './service.ts';

type ConsolidationAnswer = z.infer<typeof consolidationOutput>;

/** A rule is only worth proposing when the user corrected the same thing more than once. */
const MIN_RULE_EVIDENCE = 2;

function normalized(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toTopicProposals(answer: ConsolidationAnswer['topicProposals'], input: ConsolidationInput): ConsolidationTopicProposal[] {
  const topics = new Map(input.topics.map((entry) => [entry.topic.id, entry]));
  const proposals: ConsolidationTopicProposal[] = [];
  for (const proposal of answer) {
    const source = topics.get(proposal.topicId);
    // The user reads the reason to decide; a placeholder or a few words give them nothing.
    if (!source || isJunkReason(proposal.reason)) {
      continue;
    }
    if (proposal.kind === 'rename') {
      if (normalized(proposal.name) !== normalized(source.topic.name)) {
        proposals.push(proposal);
      }
    } else if (proposal.kind === 'merge') {
      // The prompt says size or a finished state is no reason; this catches an answer that says it anyway.
      if (proposal.intoTopicId !== proposal.topicId && topics.has(proposal.intoTopicId) && !isSizeOrStateOnlyMergeReason(proposal.reason)) {
        proposals.push(proposal);
      }
    } else {
      // Split: only PR keys the prompt listed under that topic.
      const shown = new Set(source.dossier?.dossier.timeline.map((entry) => entry.prKey) ?? []);
      const prKeys = [...new Set(proposal.prKeys.filter((key) => shown.has(key)))];
      if (prKeys.length > 0) {
        proposals.push({ ...proposal, prKeys });
      }
    }
  }
  return proposals;
}

/** Keep and drop ids must all come from one duplicate group, and each fact is dropped at most once. */
function toFactMerges(answer: ConsolidationAnswer['factMerges'], input: ConsolidationInput): FactMerge[] {
  const groupOf = new Map<string, number>();
  input.duplicateFacts.forEach((group, index) => group.forEach((fact) => groupOf.set(fact.id, index)));
  const used = new Set<string>();
  const merges: FactMerge[] = [];
  for (const merge of answer) {
    const group = groupOf.get(merge.keepId);
    if (group === undefined || used.has(merge.keepId)) {
      continue;
    }
    const dropIds = [...new Set(merge.dropIds)].filter(
      (id) => id !== merge.keepId && groupOf.get(id) === group && !used.has(id),
    );
    if (dropIds.length === 0) {
      continue;
    }
    used.add(merge.keepId);
    dropIds.forEach((id) => used.add(id));
    merges.push({ keepId: merge.keepId, dropIds, reason: merge.reason });
  }
  return merges;
}

/**
 * A rule needs MIN_RULE_EVIDENCE shown corrections, at least one of them in
 * the user's words (a note, a kept tailoring, a forgotten line): bare "Wrong
 * topic" clicks move PRs, they don't ask for a standing rule.
 */
function toRuleIdeas(answer: ConsolidationAnswer['rules'], input: ConsolidationInput): RuleIdea[] {
  const topicIds = new Set(input.topics.map((entry) => entry.topic.id));
  const feedbackIds = new Set(input.feedback.map((f) => f.id));
  const decided = new Set(input.decidedRules.map((rule) => ruleTextKey(rule.text)));
  const ideas: RuleIdea[] = [];
  for (const rule of answer) {
    const evidence = [...new Set(rule.evidenceFeedbackIds.filter((id) => feedbackIds.has(id)))];
    const topicOk = rule.topicId === null || topicIds.has(rule.topicId);
    if (!topicOk || evidence.length < MIN_RULE_EVIDENCE || decided.has(ruleTextKey(rule.text))) {
      continue;
    }
    if (!ruleHasWordedEvidence(evidence, input.feedback) || isJunkReason(rule.reason)) {
      continue;
    }
    decided.add(ruleTextKey(rule.text));
    ideas.push({ text: rule.text, topicId: rule.topicId, evidenceFeedbackIds: evidence, reason: rule.reason });
  }
  return ideas;
}

/** Only areas the prompt listed, never into itself, each area folded once. */
function toAreaMerges(answer: ConsolidationAnswer['areaMerges'], input: ConsolidationInput): AreaMerge[] {
  const areas = new Set(input.areas.map((area) => area.name));
  const folded = new Set<string>();
  const merges: AreaMerge[] = [];
  for (const merge of answer) {
    if (!areas.has(merge.from) || !areas.has(merge.into) || merge.from === merge.into || folded.has(merge.from) || isJunkReason(merge.reason)) {
      continue;
    }
    folded.add(merge.from);
    merges.push(merge);
  }
  return merges;
}

/**
 * Drops everything that names a topic, fact, area or feedback entry the
 * prompt did not show, and every proposal or rule without a real reason.
 */
export function mapConsolidationAnswer(answer: ConsolidationAnswer, input: ConsolidationInput): ConsolidationResult {
  const topicIds = new Set(input.topics.map((entry) => entry.topic.id));
  const finished = new Map<string, { topicId: string; reason: string }>();
  for (const entry of answer.finished) {
    if (topicIds.has(entry.topicId)) {
      finished.set(entry.topicId, entry);
    }
  }
  return {
    topicProposals: toTopicProposals(answer.topicProposals, input),
    areaMerges: toAreaMerges(answer.areaMerges, input),
    factMerges: toFactMerges(answer.factMerges, input),
    ruleIdeas: toRuleIdeas(answer.rules, input),
    finishedTopics: [...finished.values()],
  };
}
