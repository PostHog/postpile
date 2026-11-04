import type { PrEvent } from '@postpile/core';
import type { PingDecisionInput, PingDecisionItem } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prLine, viewerLine, workContextBlock } from './shared.ts';

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

/** "2026-11-04T13:59:00.000Z" to "13:59". UTC, like the now line. */
function clock(iso: string): string {
  return iso.slice(11, 16);
}

/** Ping titles are written from GitHub text, so the line is fenced. */
function historyLine(item: PingDecisionItem): string {
  if (item.pingsToday.length === 0) {
    return 'Not pinged about this PR today.';
  }
  const pings = item.pingsToday.map((ping) => `${clock(ping.at)} (${clip(ping.title, 70)})`).join(', ');
  return githubData(`Already pinged about this PR today: ${pings}`);
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
  lines.push(`Rules: ${item.rule.loudness} (${item.rule.reason}), why it reached them: ${item.rule.why}, ${turnLine(item)}`);
  if (item.rule.conversation) {
    lines.push('Live conversation: a person answers what the user said on this PR in the last two hours. It always pings; write the text.');
  }
  lines.push(
    historyLine(item),
    `New activity, newest first:\n${githubData(`${prLine(item.pr)}\n${item.events.map(eventLine).join('\n')}`)}`,
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
  const now = input.now.slice(0, 16).replace('T', ' ');
  return `You decide whether new GitHub activity is worth a desktop notification that interrupts a developer.
It is now ${now} UTC; the new activity below is from the last 30 minutes.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Rules already filtered out bots, CI and anything not aimed at the user. Every item below was
aimed at them: a mention, a question, a review request, new commits after they approved, or
changes requested on their own PR.
A ping interrupts their focus. The app's list holds everything and they open it when they choose, so a ping is only for what should not wait for that.
Always ping a person's ask aimed at them in person: a question or reply to them, a mention that asks them something, a review asked of them personally (RV), the first sign that an author answered their changes request, or a person asking something on their own PR. Say no to these only for a thank-you or FYI, or when the same ask already pinged today.
For everything else, say no ping unless waiting a few hours would cost something real, such as a design call in an area their instructions name. Say no ping for team requests (RT) on small or routine changes that others on the team can take, bots acting on their own PR, and repeat news about a PR they were already pinged about today.
"Why it reached them" codes: RV review asked of them. RT review asked of their team, not of them. Ping only when the change needs them in particular: a design question in the areas their instructions name, stamphog declined and the PR needs a human with their context, or a topic they drive. A teammate wrote it is not enough on its own.
Other codes: @ mentioned them, @T mentioned their team, AS assigned, AU their own PR, CM they took part, FW following.

Pings sent in the last hour: ${input.pingsLastHour}

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
