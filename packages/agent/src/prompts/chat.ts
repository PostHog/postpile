import type { ChatMessage } from '@code-manager/core';
import type { ChatInput } from '../service.ts';
import { clip, contextBlock, jsonOnly, prDetails, shortDetail } from './shared.ts';

function historyLine(message: ChatMessage): string {
  const who = message.role === 'user' ? 'User' : 'You';
  return `${who}: ${clip(message.text, 1000)}`;
}

/**
 * Chat on a tile. Besides answering, the agent spots lasting points ("always
 * flag migrations in this topic") and proposes them as topic tailoring. The
 * user confirms "keep it" or "just this once"; nothing is stored from here.
 */
export function chatPrompt(input: ChatInput): string {
  const prs = input.prs.map((pr) => prDetails(pr, null, shortDetail)).join('\n\n---\n\n');
  const history = input.history.length === 0 ? '(no earlier messages)' : input.history.slice(-20).map(historyLine).join('\n');
  return `You are the assistant inside a developer's code review inbox, chatting about one tile
("${input.tile.title}") in the topic "${input.topic.name}". ${input.topic.summary}
${contextBlock(input.context)}
Pull requests on this tile:

${prs}

Conversation so far:
${history}

User: ${input.message}

Answer the user in plain words, short. You cannot take actions on GitHub; say what they could do.
If their message contains a lasting instruction for how to treat this topic in future (what
matters to them here, what to flag, what to ignore), put it in "tailoring" as one short
instruction written as the user would say it. Otherwise "tailoring" is null. A one-off question
is not tailoring.
${jsonOnly('{"reply": "...", "tailoring": "..." | null}')}`;
}
