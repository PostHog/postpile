import { dossierBrief } from '@code-manager/core';
import type { Fact, Feedback, RuleProposal, TopicProposal } from '@code-manager/core';
import type { ConsolidationInput, ConsolidationTopic } from '../service.ts';
import { clip, contextBlock, entityText, jsonOnly } from './shared.ts';

function topicBlock(entry: ConsolidationTopic): string {
  const { topic, dossier } = entry;
  const activity = entry.lastActivityAt ? `last activity ${entry.lastActivityAt.slice(0, 10)}` : 'no activity yet';
  const lines = [`- id ${topic.id}: "${topic.name}" | ${entry.openPrs} open of ${entry.totalPrs} PRs | ${activity}`];
  const brief = dossier ? dossierBrief(dossier.dossier) : clip(topic.summary, 400);
  if (brief) {
    lines.push(`  ${brief}`);
  }
  for (const flag of dossier?.flags ?? []) {
    if (flag.kind === 'looks_finished' || flag.kind === 'off_topic_pr') {
      lines.push(`  flag ${flag.kind}${flag.prKey ? ` ${flag.prKey}` : ''}: ${flag.text}`);
    }
  }
  for (const entryPr of dossier?.dossier.timeline ?? []) {
    lines.push(`  pr ${entryPr.prKey}: ${clip(entryPr.role, 60)}`);
  }
  return lines.join('\n');
}

function factGroupBlock(group: Fact[], index: number): string {
  const facts = group.map((f) => `  - id ${f.id}: ${f.text} (since ${f.validFrom.slice(0, 10)}, ${f.refs.length} sources)`);
  const first = group[0];
  const head = first ? `[${first.predicate}] ${entityText(first.subject)}` : '';
  return `Group ${index + 1} ${head}\n${facts.join('\n')}`;
}

function feedbackLine(f: Feedback): string {
  const about = [f.topicId && `topic ${f.topicId}`, f.prKey].filter(Boolean).join(', ');
  return `- #${f.id} ${f.createdAt.slice(0, 10)} ${f.kind}${about ? ` (${about})` : ''}: ${clip(f.note, 200)}`;
}

function decidedRuleLine(rule: RuleProposal): string {
  return `- ${rule.status}: ${rule.text}${rule.topicId ? ` (topic ${rule.topicId})` : ''}`;
}

function decidedTopicLine(p: TopicProposal): string {
  const target = p.kind === 'merge' ? ` into ${p.intoTopicId}` : p.name ? ` "${p.name}"` : '';
  return `- ${p.status}: ${p.kind} ${p.topicId ?? ''}${target}`;
}

function listOrNone(lines: string[]): string {
  return lines.length === 0 ? '(none)' : lines.join('\n');
}

/**
 * The sleep-time job: one look across every active topic. Everything it
 * returns is a proposal (topic changes, rules) or internal housekeeping (fact
 * merges); retiring a topic also needs the engine's deterministic gate.
 */
export function consolidationPrompt(input: ConsolidationInput): string {
  return `You tidy up the memory of a developer's code review inbox. Work is grouped into topics, each
with a dossier; small facts are stored about people, PRs and code areas. Look across everything
below and propose what should change.
${contextBlock(input.context)}
Active topics:
${listOrNone(input.topics.map(topicBlock))}

Stored facts that may be duplicates (same subject and predicate):
${listOrNone(input.duplicateFacts.map(factGroupBlock))}

Recent corrections from the user, newest first:
${listOrNone(input.feedback.map(feedbackLine))}

Rules the user already decided on (never propose these again):
${listOrNone(input.decidedRules.map(decidedRuleLine))}

Topic changes the user already decided on (never propose these again):
${listOrNone(input.decidedTopicProposals.map(decidedTopicLine))}

What to return, all optional; empty lists are the usual answer:
- topicProposals: rename (the name no longer fits the work), merge (two topics are the same work;
  topicId is merged into intoTopicId), split (a topic holds two separate pieces of work; one entry
  per new part, with the PR keys to move out, taken from that topic's pr lines). Topic ids only
  from the list above.
- factMerges: inside one duplicate group, facts that say the same thing. keepId = the best one,
  dropIds = the rest.
- rules: a standing rule when the user corrected the same kind of thing several times. Write it
  as the user would say it, one sentence. topicId null for a global rule, else the topic id.
  evidenceFeedbackIds = the # ids of the corrections behind it (at least two).
- finished: topics whose work looks done. The engine double-checks before retiring any.
reason: one short sentence each, the user will read it.
${jsonOnly(`{
  "topicProposals": [{"kind": "rename", "topicId": "...", "name": "...", "reason": "..."}, {"kind": "merge", "topicId": "...", "intoTopicId": "...", "reason": "..."}, {"kind": "split", "topicId": "...", "name": "...", "prKeys": ["owner/repo#1"], "reason": "..."}],
  "factMerges": [{"keepId": "...", "dropIds": ["..."], "reason": "..."}],
  "rules": [{"text": "...", "topicId": null, "evidenceFeedbackIds": [1, 2], "reason": "..."}],
  "finished": [{"topicId": "...", "reason": "..."}]
}`)}`;
}
