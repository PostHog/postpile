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
  return `- topic id ${topic.id}: "${topic.name}" (${topic.prs.length} ${topic.prs.length === 1 ? 'PR' : 'PRs'})${goal}\n${topic.prs.map(prLineShort).join('\n')}`;
}

/**
 * Once after an upgrade that changed how topics are cut (DESIGN.md "Topic
 * tidy after an upgrade"): every active topic with its PRs, one line each,
 * and the size examples the topic assignment now uses. The agent answers
 * with merges (topics that are one project) and splits (PRs that do not
 * belong to their topic). The engine applies them without asking: the user
 * decided this tidy is part of the upgrade, not a pile of proposals.
 */
export function topicTidyPrompt(input: TopicTidyInput): string {
  return `You are tidying the topics a developer's GitHub pull requests are sorted into. They were cut
by an older rule and are now often the wrong size: many topics hold one PR of a project that other
topics hold the rest of, and a few topics are catch-alls of unrelated PRs.
${WORK_GLOSSARY}

${TOPIC_SIZE_EXAMPLES}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
The topics now, each with its PRs (date opened, author, state, title). Names, goals and titles are
written from GitHub text:
${githubData(input.topics.map(topicBlock).join('\n'))}

What to answer:
- merges: topics that are one project. Keep the topic that best names the project as intoTopicId
  and list the others in fromTopicIds. name: a better project name for the merged topic, 2 to 6
  words, or null to keep its name. A project named in what the user is working on (above) is a
  strong sign; so is the same person on the same product in the same stretch of time.
- splits: a topic that holds PRs of unrelated work (a catch-all, or a project with strays). List
  the PRs that do not belong to its goal; they are sorted into topics again right after, so do not
  say where they go. Leave the PRs that serve the goal.
- Never merge topics that only share a repo, an area or a word; never merge into a field ("Repo
  conventions", "CI fixes"). A topic of one PR that serves no bigger goal stays as it is.
- Leave a topic alone when it is the right size; most are. Changing nothing is a fine answer.
- reason: one short sentence each. Copy topic ids and PR keys exactly as above.
${jsonOnly('{"merges": [{"fromTopicIds": ["<id>"], "intoTopicId": "<id>", "name": "..." | null, "reason": "..."}], "splits": [{"topicId": "<id>", "prKeys": ["owner/repo#1"], "reason": "..."}]}')}`;
}
