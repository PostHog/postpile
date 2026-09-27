import type { TopicSummaryInput } from '../service.ts';
import { clip, contextBlock, jsonOnly, prLine } from './shared.ts';

function otherTopicsBlock(input: TopicSummaryInput): string {
  if (input.otherTopics.length === 0) {
    return '(none)';
  }
  return input.otherTopics.map((t) => `- ${t.id}: ${t.name}${t.summary ? ` - ${clip(t.summary, 150)}` : ''}`).join('\n');
}

/**
 * The topic's running summary, shown in the topic list and fed to topic
 * assignment. It is also where the agent may suggest a rename or merge; those
 * only become pending proposals, never direct changes.
 */
export function topicSummaryPrompt(input: TopicSummaryInput): string {
  const prs = input.prs.map((pr) => `${prLine(pr)}\n  ${clip(pr.body, 300) || '(no description)'}`).join('\n\n');
  const current = input.topic.summary ? `\nThe current summary, keep what is still true:\n${input.topic.summary}\n` : '';
  return `You are keeping a short summary of an ongoing piece of work, the topic "${input.topic.name}",
for a developer who follows it on GitHub.
${contextBlock(input.context)}${current}
Pull requests in the topic:

${prs}

Other topics (id: name):
${otherTopicsBlock(input)}

Write two to four plain sentences: what the work is, where it stands (what landed, what is in
flight), and who drives it. No headings, no lists, reference PRs like owner/repo#123 only when
it helps.

proposals: if the name "${input.topic.name}" clearly no longer fits the work, propose a rename.
If this topic is clearly the same work as one of the other topics, propose a merge into that
topic's id. The user decides. An empty list is the usual answer.
${jsonOnly('{"summary": "...", "proposals": [{"kind": "rename", "name": "...", "reason": "..."}, {"kind": "merge", "intoTopicId": "...", "reason": "..."}]}')}`;
}
