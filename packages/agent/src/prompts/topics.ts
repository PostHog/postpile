import type { TopicAssignmentInput, TopicChoice } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prDetails, shortDetail, viewerLine, WORK_GLOSSARY, workContextBlock } from './shared.ts';

/** The dossier brief (goal, status, driver) says far more than a name; the summary is the fallback. */
function topicLine(topic: TopicChoice): string {
  const about = topic.brief || clip(topic.summary, 400);
  const size = `${topic.memberCount} ${topic.memberCount === 1 ? 'PR' : 'PRs'}, ${topic.openCount} open`;
  const active = topic.lastActivityAt ? `, last activity ${topic.lastActivityAt.slice(0, 10)}` : '';
  return `- id ${topic.id}: "${topic.name}" (${size}${active})${about ? ` - ${about}` : ''}`;
}

/**
 * Sorts new or changed PRs into the user's topics. Every PR gets one: an
 * existing topic or a new one. A topic is one goal (WORK_GLOSSARY): a PR
 * joins a live goal it serves or came out of, else it gets a new topic.
 * Broad buckets are what made unrelated PRs pile into one topic, so the
 * prompt no longer prefers them. The engine creates new topics directly;
 * renames and merges stay proposals the user decides on.
 */
export function topicAssignmentPrompt(input: TopicAssignmentInput): string {
  const topics = input.topics.length === 0 ? '(none yet)' : input.topics.map(topicLine).join('\n');
  const prs = input.prs.map((pr) => prDetails(pr, input.viewer, shortDetail)).join('\n\n---\n\n');
  return `You are sorting GitHub pull requests into topics for a developer.
${WORK_GLOSSARY}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Existing topics (names and briefs are written from GitHub text):
${githubData(topics)}

Pull requests to sort:

${prs}

Rules:
- Give every pull request above exactly one entry, using its key as prKey (e.g. "owner/repo#123").
- Use an existing topic when the PR serves its goal, or came out of that work while the goal is
  live: same people, same code, recent. A goal is live when the topic has open PRs or activity in
  the last two weeks. Judge by the topic's goal and people, not by its name or area.
- A finished or quiet topic only takes a PR that clearly continues that exact goal (a follow-up
  fix to it). Anything else there is a new topic.
- Every pull request gets a topic. When no live topic's goal fits, use kind "new", even for a
  single PR; never park a PR in a topic it only shares a repo, an area or a word with. Name the
  new topic after the goal the PR serves, 2 to 6 words ("Storybook visual review", "Desktop app
  release"), never after the PR's title. PRs above that serve the same goal get the same new
  name.
- reason: one short sentence on why the PR belongs there.
${jsonOnly('{"assignments": [{"prKey": "owner/repo#1", "kind": "existing", "topicId": "<id>", "reason": "..."} | {"prKey": "owner/repo#2", "kind": "new", "name": "...", "reason": "..."}]}')}`;
}
