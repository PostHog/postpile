import type { PrEvent } from '@code-manager/core';
import type { EventBatchInput } from '../service.ts';
import { contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prLine, viewerLine } from './shared.ts';

function eventLine(event: PrEvent): string {
  const bot = event.isBot ? ' (bot)' : '';
  return `- id ${event.id} | ${event.at} | ${event.kind} by @${event.actor}${bot} | rules said ${event.ruleLoudness} (${event.ruleReason}) | ${event.summary}`;
}

/**
 * Second opinion on rule loudness for every PR of one topic with new loud
 * events, in one call. Rules cannot tell "can you take a look?" from
 * "thanks!", or a meaningful bot comment from a rebase on a draft. The agent
 * only returns the events it disagrees with.
 */
export function eventBatchPrompt(input: EventBatchInput): string {
  const topic = input.topic ? ` They belong to the topic "${input.topic.name}".` : '';
  const sections = input.items
    .map((item) => `${prLine(item.pr)}\n${item.events.map(eventLine).join('\n')}`)
    .join('\n\n');
  return `You are deciding which activity on GitHub pull requests deserves a developer's attention.${topic}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Loudness levels:
- loud: the user should look now. Someone asks them something or needs them, new commits after
  they approved, the PR merged without their review when their instructions care about that.
- quiet: worth a dot, not worth interrupting: bots, CI, deploys, merge queue, routine chatter.
- muted: pure noise, hidden: bot rebases on a draft, repeated bot nags, automated status spam.

Pull requests and their new events, with what simple rules decided:

${githubData(sections)}

Only list events where the rules got it wrong. Most of the time the rules are right and the
list is empty. reason: one short sentence the user will see.
${jsonOnly('{"overrides": [{"eventId": "...", "loudness": "loud" | "quiet" | "muted", "reason": "..."}]}')}`;
}
