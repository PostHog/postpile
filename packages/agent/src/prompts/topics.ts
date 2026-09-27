import type { TopicAssignmentInput, TopicChoice } from '../service.ts';
import { clip, contextBlock, jsonOnly, prDetails, shortDetail, viewerLine } from './shared.ts';

/** The dossier brief (goal, status, driver) says far more than a name; the summary is the fallback. */
function topicLine(topic: TopicChoice): string {
  const about = topic.brief || clip(topic.summary, 400);
  return `- id ${topic.id}: "${topic.name}"${about ? ` - ${about}` : ''}`;
}

/**
 * Sorts new or changed PRs into the user's topics. Topics must stay stable,
 * so the prompt pushes hard towards existing ones. The engine creates new
 * topics directly; renames and merges stay proposals the user decides on.
 */
export function topicAssignmentPrompt(input: TopicAssignmentInput): string {
  const topics = input.topics.length === 0 ? '(none yet)' : input.topics.map(topicLine).join('\n');
  const prs = input.prs.map((pr) => prDetails(pr, input.viewer, shortDetail)).join('\n\n---\n\n');
  return `You are sorting GitHub pull requests into topics for a developer. A topic is a piece of
ongoing work that spans PRs, like "Move CI to Depot" or "Session replay ingestion rewrite".
${viewerLine(input.viewer)}
${contextBlock(input.context)}
Existing topics:
${topics}

Pull requests to sort:

${prs}

Rules:
- Give every pull request above exactly one entry, using its key as prKey (e.g. "owner/repo#123").
- Prefer an existing topic whenever the PR plausibly belongs to it. Topics must stay stable.
  Judge by the topic's goal and people, not only its name. A finished topic is fine when the PR
  continues that work.
- Only use kind "new" when no existing topic fits. Name it after the work, 2 to 6 words, not
  after one PR's title. PRs that belong together get the same new name.
- reason: one short sentence on why the PR belongs there.
${jsonOnly('{"assignments": [{"prKey": "owner/repo#1", "kind": "existing", "topicId": "<id>", "reason": "..."} | {"prKey": "owner/repo#2", "kind": "new", "name": "...", "reason": "..."}]}')}`;
}
