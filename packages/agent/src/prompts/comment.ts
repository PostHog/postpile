import type { DraftCommentInput } from '../service.ts';
import { contextBlock, fullDetail, jsonOnly, prDetails, viewerLine } from './shared.ts';

/** "Ask <person>": a PR comment the user edits before it is sent. Never sent by the agent. */
export function draftCommentPrompt(input: DraftCommentInput): string {
  const intent = input.intent.trim()
    ? `What the user wants to ask, in their own words: ${input.intent.trim()}`
    : 'The user did not say what to ask. Pick the most useful open question for this person.';
  return `You are drafting a GitHub PR comment that the user will edit and post themselves.
${viewerLine(input.viewer)}
${contextBlock(input.context)}
The comment is addressed to @${input.person}.
${intent}

The pull request:
${prDetails(input.pr, input.viewer, fullDetail)}

Write it the way the user would: short, direct, friendly, no filler, no sign-off. Start with
@${input.person}. GitHub markdown is fine. One question per comment unless they asked for more.
${jsonOnly('{"body": "..."}')}`;
}
