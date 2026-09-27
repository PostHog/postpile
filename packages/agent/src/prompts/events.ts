import type { PrEvent } from '@code-manager/core';
import type { EventClassificationInput } from '../service.ts';
import { contextBlock, jsonOnly, prLine, viewerLine } from './shared.ts';

function eventLine(event: PrEvent): string {
  const bot = event.isBot ? ' (bot)' : '';
  return `- id ${event.id} | ${event.at} | ${event.kind} by @${event.actor}${bot} | rules said ${event.ruleLoudness} (${event.ruleReason}) | ${event.summary}`;
}

/**
 * Second opinion on the rule-based loudness. Rules cannot tell "can you take
 * a look?" from "thanks!", or a meaningful bot comment from a rebase on a
 * draft. The agent only returns the events it disagrees with.
 */
export function eventClassificationPrompt(input: EventClassificationInput): string {
  return `You are deciding which activity on a GitHub pull request deserves a developer's attention.
${viewerLine(input.viewer)}
${contextBlock(input.context)}
The pull request: ${prLine(input.pr)}

Loudness levels:
- loud: the user should look now. Someone asks them something or needs them, new commits after
  they approved, the PR merged without their review when their instructions care about that.
- quiet: worth a dot, not worth interrupting: bots, CI, deploys, merge queue, routine chatter.
- muted: pure noise, hidden: bot rebases on a draft, repeated bot nags, automated status spam.

Events, with what simple rules decided:
${input.events.map(eventLine).join('\n')}

Only list events where the rules got it wrong. Most of the time the rules are right and the
list is empty. reason: one short sentence the user will see.
${jsonOnly('{"overrides": [{"eventId": "...", "loudness": "loud" | "quiet" | "muted", "reason": "..."}]}')}`;
}
