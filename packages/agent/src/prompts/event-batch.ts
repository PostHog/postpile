import type { EventBatchInput } from '../service.ts';
import { eventLine } from './events.ts';
import { contextBlock, jsonOnly, prLine, viewerLine } from './shared.ts';

/**
 * Second opinion on rule loudness for every PR of one topic with new loud
 * events, in one call. Same levels and rules as the single-PR prompt.
 */
export function eventBatchPrompt(input: EventBatchInput): string {
  const topic = input.topic ? ` They belong to the topic "${input.topic.name}".` : '';
  const sections = input.items
    .map((item) => `${prLine(item.pr)}\n${item.events.map(eventLine).join('\n')}`)
    .join('\n\n');
  return `You are deciding which activity on GitHub pull requests deserves a developer's attention.${topic}
${viewerLine(input.viewer)}
${contextBlock(input.context)}
Loudness levels:
- loud: the user should look now. Someone asks them something or needs them, new commits after
  they approved, the PR merged without their review when their instructions care about that.
- quiet: worth a dot, not worth interrupting: bots, CI, deploys, merge queue, routine chatter.
- muted: pure noise, hidden: bot rebases on a draft, repeated bot nags, automated status spam.

Pull requests and their new events, with what simple rules decided:

${sections}

Only list events where the rules got it wrong. Most of the time the rules are right and the
list is empty. reason: one short sentence the user will see.
${jsonOnly('{"overrides": [{"eventId": "...", "loudness": "loud" | "quiet" | "muted", "reason": "..."}]}')}`;
}
