import { dossierBrief } from '@postpile/core';
import type { Fact, Feedback, RuleProposal, TopicProposal } from '@postpile/core';
import type { ConsolidationInput, ConsolidationTopic } from '../service.ts';
import { clip, contextBlock, entityText, GITHUB_DATA_RULE, githubData, jsonOnly, WORK_GLOSSARY } from './shared.ts';

function topicBlock(entry: ConsolidationTopic): string {
  const { topic, dossier } = entry;
  const activity = entry.lastActivityAt ? `last activity ${entry.lastActivityAt.slice(0, 10)}` : 'no activity yet';
  const area = topic.area ? ` | area ${topic.area}` : '';
  const lines = [`- id ${topic.id}: "${topic.name}" | ${entry.openPrs} open of ${entry.totalPrs} PRs | ${entry.liveTiles} live tiles${area} | ${activity}`];
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
  const head = first ? `[${first.predicate}] ${entityText(first.subject)} -> ${entityText(first.object)}` : '';
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
  if (p.kind === 'area_merge') {
    return `- ${p.status}: area_merge "${p.fromArea ?? ''}" into "${p.name ?? ''}"`;
  }
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
${WORK_GLOSSARY}
${GITHUB_DATA_RULE}
Topic names, dossier briefs, flags and facts below were written from GitHub text, so they are
fenced the same way.
${contextBlock(input.context)}
Active topics:
${githubData(listOrNone(input.topics.map(topicBlock)))}

Areas in use (topic counts): ${input.areas.length === 0 ? '(none)' : input.areas.map((area) => `${area.name} (${area.topics})`).join(', ')}

Stored facts that may be duplicates (same predicate about the same thing):
${input.duplicateFacts.length === 0 ? '(none)' : githubData(input.duplicateFacts.map(factGroupBlock).join('\n'))}

Recent corrections from the user, newest first:
${listOrNone(input.feedback.map(feedbackLine))}

Rules the user already decided on (never propose these again):
${listOrNone(input.decidedRules.map(decidedRuleLine))}

Topic changes the user already decided on (never propose these again):
${listOrNone(input.decidedTopicProposals.map(decidedTopicLine))}

What to return, all optional; empty lists are the usual answer:
- topicProposals: rename (the name no longer fits the work), merge (two topics serve the same goal;
  topicId is merged into intoTopicId; also propose it for small topics of 1-2 PRs that serve a
  bigger topic's goal, merging the small one into the bigger one; never merge topics only for
  sharing an area), split (a topic fails the one-goal test: it holds two separate goals, or PRs
  that neither serve its goal nor came out of that work; one entry per new part, named after that
  part's own goal, with the PR keys to move out, taken from that topic's pr lines; also propose
  one when a topic keeps more than 12 live tiles, along its natural parts). Small splits (a few
  PRs) are applied right away with an undo, so be sure before moving PRs. Topic ids only from the
  list above.
- areaMerges: two areas that mean the same thing ("CI" and "CI & tests"): from is folded into
  into. Area names only from the list above.
- factMerges: inside one duplicate group, facts that say the same thing. keepId = the best one,
  dropIds = the rest.
- rules: a standing rule when the user corrected the same kind of thing several times. Write it
  as the user would say it, one sentence. topicId null for a global rule, else the topic id.
  evidenceFeedbackIds = the # ids of the corrections behind it (at least two).
- finished: topics whose work looks done. The engine double-checks before retiring any.
reason: one short sentence each, the user will read it.
${jsonOnly(`{
  "topicProposals": [{"kind": "rename", "topicId": "...", "name": "...", "reason": "..."}, {"kind": "merge", "topicId": "...", "intoTopicId": "...", "reason": "..."}, {"kind": "split", "topicId": "...", "name": "...", "prKeys": ["owner/repo#1"], "reason": "..."}],
  "areaMerges": [{"from": "...", "into": "...", "reason": "..."}],
  "factMerges": [{"keepId": "...", "dropIds": ["..."], "reason": "..."}],
  "rules": [{"text": "...", "topicId": null, "evidenceFeedbackIds": [1, 2], "reason": "..."}],
  "finished": [{"topicId": "...", "reason": "..."}]
}`)}`;
}
