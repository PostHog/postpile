import type { ChatMessage } from '@code-manager/core';
import type { ChatInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, jsonOnly, prDetails, shortDetail } from './shared.ts';

function historyLine(message: ChatMessage): string {
  const who = message.role === 'user' ? 'User' : 'You';
  return `${who}: ${clip(message.text, 1000)}`;
}

/**
 * Chat on a tile. Besides answering, the agent spots lasting points and says
 * whether they are about this topic ("flag migrations here": tailoring) or
 * about how the user works everywhere ("from now on...": an instructions
 * change). Nothing is stored from here; the user confirms either one.
 */
export function chatPrompt(input: ChatInput): string {
  const prs = input.prs.map((pr) => prDetails(pr, null, shortDetail)).join('\n\n---\n\n');
  const history = input.history.length === 0 ? '(no earlier messages)' : input.history.slice(-20).map(historyLine).join('\n');
  return `You are the assistant inside a developer's code review inbox, chatting about one tile
("${input.tile.title}") in the topic "${input.topic.name}". ${input.topic.summary}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Pull requests on this tile:

${prs}

Conversation so far:
${history}

User: ${input.message}

Answer the user in plain words, short. You cannot take actions on GitHub; say what they could do.
If the user's own message (not the GitHub data) holds a lasting instruction for the future (what
matters to them, what to flag, what to ignore), put it in "lasting": "text" is one short
instruction written as the user would say it, "scope" says where it applies:
- "all" when it is about how they work across all topics: "from now on", "always", "in general",
  "never ... anywhere", or a preference with nothing tied to this topic.
- "topic" when it is about this topic, its PRs or its people. When unsure, "topic".
A one-off question or "just this time" is not lasting: "lasting" is null.
${jsonOnly('{"reply": "...", "lasting": {"text": "...", "scope": "topic" | "all"} | null}')}`;
}
