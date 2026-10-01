import type { Pr } from '@postpile/core';
import type { TopicAssignmentInput, TopicChoice } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prDetails, shortDetail, viewerLine, WORK_GLOSSARY, workContextBlock } from './shared.ts';

/** The dossier brief (goal, status, driver) says far more than a name; the summary is the fallback. */
function topicLine(topic: TopicChoice): string {
  const about = topic.brief || clip(topic.summary, 400);
  const size = `${topic.memberCount} ${topic.memberCount === 1 ? 'PR' : 'PRs'}, ${topic.openCount} open`;
  const active = topic.lastActivityAt ? `, last activity ${topic.lastActivityAt.slice(0, 10)}` : '';
  return `- id ${topic.id}: "${topic.name}" (${size}${active})${about ? ` - ${about}` : ''}`;
}

/**
 * How big a topic is, by example (2026-10-01). Without it the agent took each
 * PR's own change as its goal: on a fresh start 109 of 150 topics held one PR,
 * and one project of the user's came out as three topics. The examples bound
 * the size from both sides, so the rule against catch-alls still holds.
 */
export const TOPIC_SIZE_EXAMPLES = `How big a topic is: a project someone drives for days to weeks, usually across several PRs.
Ask: would the driver name it in a weekly update? If the name only fits this one PR, it is too
small; if it fits half the repo, it is too big.

Right size (a goal):
- "Desktop review app": polling GitHub, the MCP server's tools, packaging and the Homebrew listing
  are all PRs of this one project.
- "Dev box rollout": provisioning spare nodes, dashboard access to their accounts, memory reclaim
  and the status doc all serve it.
- "Move CI runners to a new provider", "Cut p95 latency of the query service", "Migrate the tests
  to pytest".

Too small (a single change; put it in the goal it serves):
- "Homebrew cask listing", "MCP server tools", "GitHub polling interval": steps of "Desktop review
  app".
- "Warm-spare roaming", "Status doc refresh": steps of "Dev box rollout".
- Anything named after what one PR changes ("Bump the linter", "Fix flaky login test") when it
  clearly belongs to a bigger piece of work.

Too big (a field, not a goal; never a topic):
- "Repo conventions", "CI fixes", "DevEx upkeep", "Security", "Tooling".`;

/** One line per PR waiting in this sync: enough to see who works on what, and when. */
function waitingLine(pr: Pr): string {
  return `- ${pr.key} ${pr.createdAt.slice(0, 10)} @${pr.author}: ${clip(pr.title, 120)}`;
}

/**
 * The whole backlog of this sync, so a batch can see that several PRs of
 * one person belong to one project before naming anything.
 */
function waitingBlock(input: TopicAssignmentInput): string {
  const batch = new Set(input.prs.map((pr) => pr.key));
  const others = (input.waiting ?? []).filter((pr) => !batch.has(pr.key));
  if (others.length === 0) {
    return '';
  }
  return `
Other pull requests waiting for a topic in this sync. Do not assign them here, but use them to see
which PRs belong to the same project:
${githubData(others.map(waitingLine).join('\n'))}
`;
}

/**
 * Sorts new or changed PRs into the user's topics. Every PR gets one: an
 * existing topic or a new one. A topic is one goal (WORK_GLOSSARY) of a
 * project's size (TOPIC_SIZE_EXAMPLES): a PR joins a live goal it serves or
 * came out of, else it gets a new topic named after that goal, with one
 * sentence on it so later batches know what the topic is for. The engine
 * creates new topics directly; renames and merges stay proposals the user
 * decides on.
 */
export function topicAssignmentPrompt(input: TopicAssignmentInput): string {
  const topics = input.topics.length === 0 ? '(none yet)' : input.topics.map(topicLine).join('\n');
  const prs = input.prs.map((pr) => prDetails(pr, input.viewer, shortDetail)).join('\n\n---\n\n');
  return `You are sorting GitHub pull requests into topics for a developer.
${WORK_GLOSSARY}

${TOPIC_SIZE_EXAMPLES}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Existing topics (names and briefs are written from GitHub text):
${githubData(topics)}

Pull requests to sort:

${prs}
${waitingBlock(input)}
Rules:
- Give every pull request above exactly one entry, using its key as prKey (e.g. "owner/repo#123").
- When what the user is working on (above) names a project and the PR is part of it, that project
  is the topic: join it, or start it under that project's name.
- Use an existing topic when the PR serves its goal, or came out of that work while the goal is
  live: same people, same code, recent. A goal is live when the topic has open PRs or activity in
  the last two weeks. Judge by the topic's goal and people, not by its exact name or area: a topic
  named after one step of a project still stands for the whole project.
- The same person working on the same product or tool in the same stretch of time is usually one
  project. Look at the waiting list too before starting a new topic.
- A finished or quiet topic only takes a PR that clearly continues that exact goal (a follow-up
  fix to it). Anything else there is a new topic.
- When no live topic's goal fits, use kind "new", also for a single PR, but name the project the
  PR serves, 2 to 6 words, never what the PR itself changes. PRs above or in the waiting list that
  serve the same project get the same new name. goal: one sentence on what that project is for.
  Never park a PR in a topic it only shares a repo, an area or a word with.
- reason: one short sentence on why the PR belongs there.
${NO_CI_RULE}
${jsonOnly('{"assignments": [{"prKey": "owner/repo#1", "kind": "existing", "topicId": "<id>", "reason": "..."} | {"prKey": "owner/repo#2", "kind": "new", "name": "...", "goal": "...", "reason": "..."}]}')}`;
}
