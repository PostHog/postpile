import type { PrEvent } from '@postpile/core';
import type { PingDecisionInput, PingDecisionItem } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prLine, viewerLine, withoutCi, workContextBlock } from './shared.ts';

function eventLine(event: PrEvent): string {
  const bot = event.isBot ? ' (bot)' : '';
  return `- ${event.at.slice(0, 16)} ${event.kind} by @${event.actor}${bot}: ${clip(event.summary, 400)}`;
}

function turnLine(item: PingDecisionItem): string {
  const turn = item.rule.whoseTurn;
  if (turn.kind === 'you') {
    return `their move: ${turn.what}`;
  }
  if (turn.kind === 'them' && turn.who === null) {
    return turn.what.toLowerCase();
  }
  if (turn.kind === 'them') {
    return `waiting on @${turn.who} ${turn.what}`;
  }
  return 'nobody has a move';
}

function itemSection(item: PingDecisionItem): string {
  // Topic names are written from GitHub text: fenced like it.
  const topic = item.topicName === null ? 'Topic: (not sorted into a topic yet)' : `Topic:\n${githubData(item.topicName)}`;
  const lines = [`## Item ${item.id}`, topic];
  if (item.tailoring.trim()) {
    lines.push(`The user's instructions for this topic: ${clip(item.tailoring, 800)}`);
  }
  if (item.dossierBrief) {
    lines.push(`Topic memory:\n${githubData(clip(item.dossierBrief, 600))}`);
  }
  if (item.glance) {
    lines.push(`Earlier read of the PR: ${item.glance.verdict}. ${githubData(clip(item.glance.forYou, 300))}`);
  }
  lines.push(
    `Rules: ${item.rule.loudness} (${item.rule.reason}), why it reached them: ${item.rule.why}, ${turnLine(item)}`,
    `New activity, newest first:\n${githubData(`${prLine(item.pr)}\n${withoutCi(item.events).map(eventLine).join('\n')}`)}`,
    // The template quotes the comment, so it is GitHub text too.
    `Default notification:\n${githubData(`title: ${item.template.title}\nbody: ${item.template.body.replaceAll('\n', ' / ')}`)}`,
  );
  return lines.join('\n');
}

/**
 * The fast poll found new activity the rules would ping the user's Mac for.
 * The agent vetoes pings that are not worth an interruption and writes a
 * short, concrete notification for the rest. It never adds pings: items the
 * rules kept quiet are not in the prompt.
 */
export function pingDecisionPrompt(input: PingDecisionInput): string {
  const sections = input.items.map(itemSection).join('\n\n');
  return `You decide whether new GitHub activity is worth a desktop notification that interrupts a developer.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Rules already filtered out bots, CI and anything not aimed at the user. Every item below was
aimed at them: a mention, a question, a review request, new commits after they approved, or
changes requested on their own PR. Ping by default. Say no ping only when it is clearly not worth
an interruption now, for example a thank-you or "no action needed" mention, a review request
their instructions say they do not care about, or chatter already answered.
"Why it reached them" codes: RV review asked of them, RT review asked of their team (not them in
person, so ping only when it looks like it needs them; but when whose turn reads "Review for
<team>: <author>'s PR" a teammate wrote it and it counts like RV), @ mentioned them, @T mentioned
their team, AS assigned, AU their own PR, CM they took part, FW following.

${sections}

For each item answer:
- ping: true or false.
- title: at most 70 characters, who wants what, e.g. "@alice needs your review on the Depot runner PR".
- body: at most 180 characters, the concrete ask or change in plain words. No markdown.
- reason: one short sentence for the user's debug log, why ping or not.
${NO_CI_RULE}
Answer every item, with its id.
${jsonOnly('{"decisions": [{"id": "...", "ping": true, "title": "...", "body": "...", "reason": "..."}]}')}`;
}
