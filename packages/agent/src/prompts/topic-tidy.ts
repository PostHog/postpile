import type { Pr } from '@postpile/core';
import type { TidyTopic, TopicTidyInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, viewerLine, WORK_GLOSSARY, workContextBlock } from './shared.ts';
import { TOPIC_SIZE_EXAMPLES } from './topics.ts';

function prLineShort(pr: Pr): string {
  const state = pr.isDraft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase();
  return `  - ${pr.key} ${pr.createdAt.slice(0, 10)} @${pr.author} (${state}): ${clip(pr.title, 120)}`;
}

function topicBlock(topic: TidyTopic): string {
  const goal = topic.goal ? `\n  goal: ${clip(topic.goal, 300)}` : '';
  const archive = topic.inArchive ? ', in the Archive' : '';
  return `- topic id ${topic.id}: "${topic.name}" (${topic.kind}, ${topic.prs.length} ${topic.prs.length === 1 ? 'PR' : 'PRs'}${archive})${goal}\n${topic.prs.map(prLineShort).join('\n')}`;
}

/**
 * Once after an upgrade that changed how topics are cut (DESIGN.md "Topic
 * tidy after an upgrade"): every topic that still takes PRs (active, or in
 * the Archive) with its PRs, one line each, and the size examples the topic
 * assignment now uses. The agent answers with merges (topics that are one
 * goal), splits (PRs that do not belong to their topic, and where they go),
 * renames (a topic named after one step of its goal) and kind changes
 * (project or standing). The engine applies them without asking: the user
 * decided this tidy is part of the upgrade, not a pile of proposals.
 */
export function topicTidyPrompt(input: TopicTidyInput): string {
  return `You are tidying the topics a developer's GitHub pull requests are sorted into. They were cut
by an older rule and are now often the wrong size: many topics hold one PR of a goal that other
topics hold the rest of, and a few topics are catch-alls of unrelated PRs. The older rule also
treated every topic as a project with a finish line, so a standard kept up for months often sits
in several topics, each named after one deliverable.
${WORK_GLOSSARY}

${TOPIC_SIZE_EXAMPLES}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
The topics now, each with its kind and PRs (date opened, author, state, title). Topics in the
Archive have nothing open right now but still take new PRs. Names, goals and titles are written
from GitHub text:
${githubData(input.topics.map(topicBlock).join('\n'))}

What to answer:
- merges: topics that are one goal (one project, or one standard). Keep the topic that best names
  it as intoTopicId and list the others in fromTopicIds. name: a better name for the merged topic,
  2 to 6 words, or null to keep its name. A project named in what the user is working on (above) is a
  strong sign; so is the same person on the same product in the same stretch of time.
- splits: a topic that holds PRs of unrelated work (a catch-all, or a project with strays). List
  the PRs that do not belong to its goal and say where they go: intoTopicId, a topic above whose
  goal they serve, or newName, 2 to 6 words naming the goal they serve, with newKind "project" or
  "standing". One entry per destination; PRs of the same goal go to the same place. Leave the PRs
  that serve the goal.
- renames: a topic named after one step or deliverable while it holds the whole goal ("Migration
  runbook docs" holding runbooks, lock rules and guards is "Migration safety"). name: 2 to 6 words.
- kinds: only topics whose kind is wrong above. "standing" for a standard kept up with no finish
  line, "project" for a goal that ends.
- Never merge topics that only share a repo, an area or a word; never merge into a field ("Repo
  conventions", "CI fixes"). A topic of one PR that serves no bigger goal stays as it is.
- Leave a topic alone when it is the right size; most are. Changing nothing is a fine answer.
- reason: one short sentence each. Copy topic ids and PR keys exactly as above.
${jsonOnly('{"merges": [{"fromTopicIds": ["<id>"], "intoTopicId": "<id>", "name": "..." | null, "reason": "..."}], "splits": [{"topicId": "<id>", "prKeys": ["owner/repo#1"], "intoTopicId": "<id>" | null, "newName": "..." | null, "newKind": "project" | "standing", "reason": "..."}], "renames": [{"topicId": "<id>", "name": "...", "reason": "..."}], "kinds": [{"topicId": "<id>", "kind": "standing"}]}')}`;
}
