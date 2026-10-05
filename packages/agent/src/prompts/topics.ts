import type { Pr } from '@postpile/core';
import type { TopicAssignmentInput, TopicChoice } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prDetails, shortDetail, viewerLine, WORK_GLOSSARY, workContextBlock } from './shared.ts';

/** The dossier brief (goal, status, driver) says far more than a name; the summary is the fallback. */
function topicLine(topic: TopicChoice): string {
  const about = topic.brief || clip(topic.summary, 400);
  const owner = topic.ownerTeam ? `, owned by ${topic.ownerTeam}` : '';
  const size = `${topic.kind}${owner}, ${topic.memberCount} ${topic.memberCount === 1 ? 'PR' : 'PRs'}, ${topic.openCount} open`;
  const active = topic.lastActivityAt ? `, last activity ${topic.lastActivityAt.slice(0, 10)}` : '';
  return `- id ${topic.id}: "${topic.name}" (${size}${active})${about ? ` - ${about}` : ''}`;
}

/**
 * How big a topic is, by example (2026-10-01). Without it the agent took each
 * PR's own change as its goal: on a fresh start 109 of 150 topics held one PR,
 * and one project of the user's came out as three topics. The examples bound
 * the size from both sides, so the rule against catch-alls still holds.
 * Standing topics came the same day: "a project of days to weeks" split a
 * standard kept up for a year ("Migration safety") into deliverables.
 */
export const TOPIC_SIZE_EXAMPLES = `How big a topic is. Two kinds fit:
- project: one goal with a finish line, driven for days to weeks, usually across several PRs. Its
  driver can say what "done" means and would name it in a weekly update.
- standing: one standard someone keeps up for months, with no finish line. PRs arrive in waves,
  and every one is judged by the same question ("does this keep migrations safe?").
Ask: can one sentence say what a PR must do to belong? If it only fits this one PR, the topic is
too small. If it needs "and" between unrelated goals, or would fit any project ("bugs",
"front-end"), it is too big.

Right size:
- Projects: "Desktop review app" (polling GitHub, the MCP server's tools, packaging and the
  Homebrew listing are all PRs of it), "Dev box rollout", "Move CI runners to a new provider",
  "Cut p95 latency of the query service", "Migrate the tests to pytest".
- Standing: "Migration safety" (runbooks, lock rules, migration guards and the migration skill,
  for a year), "Code ownership" (teams claiming paths, routing reviews to owners), "Egress"
  (every outbound call through one layer: labels, budgets, tracing, guards, whoever adds to it).

Too small (put it in the topic it serves):
- "Homebrew cask listing", "MCP server tools": steps of "Desktop review app".
- "Hot-table migration locks", "Migration runbook docs": parts of "Migration safety". A wave of
  them is a set inside that topic, not a topic of its own.
- Anything named after what one PR changes ("Bump the linter", "Fix flaky login test") when it
  clearly belongs to a bigger piece of work.
A wave inside a standing topic is its own project only when it has its own finish line and
someone drives it for days ("Move migrations to an init step that waits for them").

Too big (a field: several unrelated goals, never a topic):
- "Repo conventions", "CI fixes", "DevEx upkeep", "Security", "Tooling", a whole product or app.`;

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
 * The topics the user took this PR out of ("Wrong topic"), after its fenced
 * details: the app speaking, like the own-PR note. Only topic ids, which the
 * list above shows with their names. Most PRs have none and read as before.
 */
function notInNote(pr: Pr, input: TopicAssignmentInput): string {
  const ids = input.notIn?.[pr.key] ?? [];
  if (ids.length === 0) {
    return '';
  }
  const topics = ids.map((id) => `topic id ${id}`).join(', ');
  return `\nThe user took this PR out of ${topics}. Never put it back there, also not as a new topic of the same name.`;
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
  const prs = input.prs.map((pr) => `${prDetails(pr, input.viewer, shortDetail)}${notInNote(pr, input)}`).join('\n\n---\n\n');
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
  live: same people, same code, recent. A project is live when it has open PRs or activity in the
  last two weeks; a standing topic is live for as long as it is listed. Judge by the topic's goal and people, not by its exact name or area: a topic
  named after one step of a project still stands for the whole project.
- The same person working on the same product or tool in the same stretch of time is usually one
  project. Look at the waiting list too before starting a new topic.
- Topics in the Archive say so in their brief. A finished project there only takes a PR that
  clearly continues that exact goal (a follow-up fix to it). A quiet standing topic there takes
  the next PR of its standard, however long it slept.
- When a finished project built something that people now extend (new uses, follow-ups by others,
  weeks later), those PRs serve a standard, not the old goal: put them in the standing topic that
  keeps it, or start one named after the standard ("Egress", not "GitHub egress tracing").
- Ownership: a PR that reaches the user through a team review request (see its pending review
  requests and the user's teams) is judged by what that team keeps up. When it changes code that
  belongs to a standard a listed standing topic keeps (same owner team, same code), it joins that
  topic, also when it is a step of someone else's project. A routed PR that fits no standing topic
  is placed like any other PR.
- When no live topic's goal fits, use kind "new", also for a single PR, but name the project the
  PR serves, 2 to 6 words, never what the PR itself changes. PRs above or in the waiting list that
  serve the same project get the same new name. goal: one sentence on what that project is for.
  topicKind: "project" when the goal has a finish line, "standing" when it is a standard kept up
  with no end.
  Never park a PR in a topic it only shares a repo, an area or a word with.
- reason: one short sentence on why the PR belongs there.
${NO_CI_RULE}
${jsonOnly('{"assignments": [{"prKey": "owner/repo#1", "kind": "existing", "topicId": "<id>", "reason": "..."} | {"prKey": "owner/repo#2", "kind": "new", "name": "...", "goal": "...", "topicKind": "project", "reason": "..."}]}')}`;
}
