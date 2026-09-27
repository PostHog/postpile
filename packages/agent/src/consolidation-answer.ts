import type { z } from 'zod';
import type { consolidationOutput } from './schemas.ts';
import type { ConsolidationInput, ConsolidationResult, ConsolidationTopicProposal, FactMerge, RuleIdea } from './service.ts';

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
    if (!source) {
      continue;
    }
    if (proposal.kind === 'rename') {
      if (normalized(proposal.name) !== normalized(source.topic.name)) {
        proposals.push(proposal);
      }
    } else if (proposal.kind === 'merge') {
      if (proposal.intoTopicId !== proposal.topicId && topics.has(proposal.intoTopicId)) {
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

function toRuleIdeas(answer: ConsolidationAnswer['rules'], input: ConsolidationInput): RuleIdea[] {
  const topicIds = new Set(input.topics.map((entry) => entry.topic.id));
  const feedbackIds = new Set(input.feedback.map((f) => f.id));
  const decided = new Set(input.decidedRules.map((rule) => normalized(rule.text)));
  const ideas: RuleIdea[] = [];
  for (const rule of answer) {
    const evidence = [...new Set(rule.evidenceFeedbackIds.filter((id) => feedbackIds.has(id)))];
    const topicOk = rule.topicId === null || topicIds.has(rule.topicId);
    if (!topicOk || evidence.length < MIN_RULE_EVIDENCE || decided.has(normalized(rule.text))) {
      continue;
    }
    decided.add(normalized(rule.text));
    ideas.push({ text: rule.text, topicId: rule.topicId, evidenceFeedbackIds: evidence, reason: rule.reason });
  }
  return ideas;
}

/** Drops everything that names a topic, fact or feedback entry the prompt did not show. */
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
    factMerges: toFactMerges(answer.factMerges, input),
    ruleIdeas: toRuleIdeas(answer.rules, input),
    finishedTopics: [...finished.values()],
  };
}
