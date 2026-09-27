import type { TopicSummaryInput } from '../service.ts';
import { clip, contextBlock, jsonOnly, prLine } from './shared.ts';

/** The topic's running summary, shown in the topic list and fed to topic assignment. */
export function topicSummaryPrompt(input: TopicSummaryInput): string {
  const prs = input.prs.map((pr) => `${prLine(pr)}\n  ${clip(pr.body, 300) || '(no description)'}`).join('\n\n');
  const current = input.topic.summary ? `\nThe current summary, keep what is still true:\n${input.topic.summary}\n` : '';
  return `You are keeping a short summary of an ongoing piece of work, the topic "${input.topic.name}",
for a developer who follows it on GitHub.
${contextBlock(input.context)}${current}
Pull requests in the topic:

${prs}

Write two to four plain sentences: what the work is, where it stands (what landed, what is in
flight), and who drives it. No headings, no lists, reference PRs like owner/repo#123 only when
it helps.
${jsonOnly('{"summary": "..."}')}`;
}
