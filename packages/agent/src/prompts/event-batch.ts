import type { Pr, PrEvent } from '@postpile/core';
import type { EventBatchInput } from '../service.ts';
import { contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prLine, viewerLine } from './shared.ts';

/** Files the PR touches, for judging whether a push after approval changes what was approved. */
const FILES_FOR_PUSHES = 20;

function filesLine(pr: Pr): string {
  const files = pr.files.slice(0, FILES_FOR_PUSHES).map((file) => file.path);
  const more = pr.files.length > files.length ? `, and ${pr.files.length - files.length} more` : '';
  return files.length > 0 ? `  files: ${files.join(', ')}${more}` : '';
}

function eventLine(event: PrEvent): string {
  const bot = event.isBot ? ' (bot)' : '';
  return `- id ${event.id} | ${event.at} | ${event.kind} by @${event.actor}${bot} | rules said ${event.ruleLoudness} (${event.ruleReason}) | ${event.summary}`;
}

function prSection(pr: Pr, events: PrEvent[]): string {
  const pushes = events.some((event) => event.kind === 'commits_after_approval');
  const files = pushes ? filesLine(pr) : '';
  return [prLine(pr), ...(files ? [files] : []), ...events.map(eventLine)].join('\n');
}

/**
 * Second opinion on rule loudness for every PR of one topic with new loud
 * events, in one call. Rules cannot tell "can you take a look?" from
 * "thanks!", or a meaningful bot comment from a rebase on a draft. The agent
 * only returns the events it disagrees with.
 */
export function eventBatchPrompt(input: EventBatchInput): string {
  const topic = input.topic ? ` They belong to the topic "${input.topic.name}".` : '';
  const sections = input.items.map((item) => prSection(item.pr, item.events)).join('\n\n');
  return `You are deciding which activity on GitHub pull requests deserves a developer's attention.${topic}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Loudness levels:
- loud: the user should look now. Someone asks them something or needs them, the PR merged
  without their review when their instructions care about that.
- quiet: worth a dot, not worth interrupting: bots, CI, deploys, merge queue, routine chatter.
- muted: pure noise, hidden: bot rebases on a draft, repeated bot nags, automated status spam.

Pushes after the user approved (commits_after_approval) start quiet: an approval stands on any
commit. Plain follow-up pushes (review fixes, small tweaks, rebases, formatting) are normally
not worth their attention; leave those out of the list. Raise one to loud only when the push
clearly changes what they signed off: a substantial change in CI, build or developer-experience
areas they approved, or new files well beyond what was reviewed. The reason says what changed.

Pull requests and their new events, with what simple rules decided:

${githubData(sections)}

Only list events where the rules got it wrong. Most of the time the rules are right and the
list is empty. reason: one short sentence the user will see.
${jsonOnly('{"overrides": [{"eventId": "...", "loudness": "loud" | "quiet" | "muted", "reason": "..."}]}')}`;
}
