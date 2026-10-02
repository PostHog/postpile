import { dossierBrief } from '@postpile/core';
import type { Fact, Feedback, RuleProposal, TopicProposal } from '@postpile/core';
import type { ConsolidationInput, ConsolidationTopic } from '../service.ts';
import { clip, contextBlock, entityText, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, WORK_GLOSSARY } from './shared.ts';

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
  const note = f.note.trim() === '' ? '(no note: a bare click)' : clip(f.note, 200);
  return `- #${f.id} ${f.createdAt.slice(0, 10)} ${f.kind}${about ? ` (${about})` : ''}: ${note}`;
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
Topic names, area names, dossier briefs, flags and facts below were written from GitHub text, so
they are fenced the same way.
${contextBlock(input.context)}
Active topics:
${githubData(listOrNone(input.topics.map(topicBlock)))}

Areas in use (topic counts):
${input.areas.length === 0 ? '(none)' : githubData(input.areas.map((area) => `${area.name} (${area.topics})`).join(', '))}

Stored facts that may be duplicates (same predicate about the same thing):
${input.duplicateFacts.length === 0 ? '(none)' : githubData(input.duplicateFacts.map(factGroupBlock).join('\n'))}

Recent corrections from the user, newest first:
${listOrNone(input.feedback.map(feedbackLine))}

Rules the user already decided on (never propose these again, nor the same idea in other words):
${listOrNone(input.decidedRules.map(decidedRuleLine))}

Topic changes the user already decided on (never propose these again; a rejected merge stays
rejected in both directions, a rejected rename means the user keeps the name):
${input.decidedTopicProposals.length === 0 ? '(none)' : githubData(input.decidedTopicProposals.map(decidedTopicLine).join('\n'))}

Every proposal interrupts the user, who has to read it and decide. Propose only what changes how
they see their work; housekeeping is not worth it. Answering with no proposals at all is fine and
expected on most runs.

What to return, all optional; empty lists are the usual answer:
- topicProposals: rename (the name no longer fits the work), merge (two topics serve the same goal;
  topicId is merged into intoTopicId; the reason says how their PRs serve that goal and what the
  user gains from one topic, e.g. "both carry the billing rollout; apart, its remaining blocker is
  hidden in the smaller one". Size and state are never a reason: "both are small", "both are
  finished", "both are winding down" or "all PRs merged" do not justify a merge. Finished topics
  are retired on their own (see finished), not merged. Never merge topics only for sharing an
  area), split (a topic fails the one-goal test: it holds two separate goals, or PRs
  that neither serve its goal nor came out of that work; one entry per new part, named after that
  part's own goal, with the PR keys to move out, taken from that topic's pr lines; also propose
  one when a topic keeps more than 12 live tiles, along its natural parts). Small splits (a few
  PRs) are applied right away with an undo, so be sure before moving PRs. Topic ids only from the
  list above.
- areaMerges: two areas that mean the same thing ("CI" and "CI & tests"): from is folded into
  into. Never fold a specific area into a catch-all like "Dev tooling". Area names only from the
  list above.
- factMerges: inside one duplicate group, facts that say the same thing. keepId = the best one,
  dropIds = the rest.
- rules: a standing rule only when the user said in words what they want, several times. Write
  it as the user would say it, one sentence. topicId null for a global rule, else the topic id.
  evidenceFeedbackIds = the # ids of the corrections behind it (at least two), and at least one of
  them must carry the user's own words (a note, a kept tailoring, a forgotten line). A bare click
  ("(no note: a bare click)") on not_mine, not_related or wrong_topic only moved one PR: it is no
  ground for a rule, never invent topic-boundary rules ("Only put a PR in topic X if ...") from
  such clicks.
- finished: topics whose work looks done. The engine double-checks before retiring any.
reason: one short sentence each that the user will read to decide: say what is true of the work
and what the change gives them. Never a placeholder; a proposal without a real reason is dropped.
${NO_CI_RULE}
${jsonOnly(`{
  "topicProposals": [{"kind": "rename", "topicId": "...", "name": "...", "reason": "..."}, {"kind": "merge", "topicId": "...", "intoTopicId": "...", "reason": "..."}, {"kind": "split", "topicId": "...", "name": "...", "prKeys": ["owner/repo#1"], "reason": "..."}],
  "areaMerges": [{"from": "...", "into": "...", "reason": "..."}],
  "factMerges": [{"keepId": "...", "dropIds": ["..."], "reason": "..."}],
  "rules": [{"text": "...", "topicId": null, "evidenceFeedbackIds": [1, 2], "reason": "..."}],
  "finished": [{"topicId": "...", "reason": "..."}]
}`)}`;
}
