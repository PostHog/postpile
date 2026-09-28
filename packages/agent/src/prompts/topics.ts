import type { TopicAssignmentInput, TopicChoice } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prDetails, shortDetail, viewerLine, workContextBlock } from './shared.ts';

/** The dossier brief (goal, status, driver) says far more than a name; the summary is the fallback. */
function topicLine(topic: TopicChoice): string {
  const about = topic.brief || clip(topic.summary, 400);
  const size = `${topic.memberCount} ${topic.memberCount === 1 ? 'PR' : 'PRs'}`;
  return `- id ${topic.id}: "${topic.name}" (${size})${about ? ` - ${about}` : ''}`;
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
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Existing topics (names and briefs are written from GitHub text):
${githubData(topics)}

Pull requests to sort:

${prs}

Rules:
- Give every pull request above exactly one entry, using its key as prKey (e.g. "owner/repo#123").
- Strongly prefer an existing topic. Topics must stay stable and few: a developer follows a
  handful of initiatives, not one topic per PR. Judge by the topic's goal and people, not only its
  name; a broader existing topic ("CI & tests", "Dev env") is better than a new narrow one. A
  finished topic is fine when the PR continues that work.
- Use kind "new" only when no existing topic fits AND either at least two PRs above belong to it,
  or the PR clearly starts a new multi-PR initiative. Name it after the work, 2 to 6 words, not
  after one PR's title. PRs that belong together get the same new name.
- A lone PR that fits nowhere and starts nothing: kind "unsorted". It waits for the next tidy-up.
- reason: one short sentence on why the PR belongs there.
${jsonOnly('{"assignments": [{"prKey": "owner/repo#1", "kind": "existing", "topicId": "<id>", "reason": "..."} | {"prKey": "owner/repo#2", "kind": "new", "name": "...", "reason": "..."} | {"prKey": "owner/repo#3", "kind": "unsorted", "reason": "..."}]}')}`;
}
