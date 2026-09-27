import type { GlanceInput } from '../service.ts';
import { contextBlock, fullDetail, howItReached, jsonOnly, prDetails, viewerLine } from './shared.ts';

/**
 * The "approve at a glance" summary from ghatchup, as JSON. forYou is the
 * part that makes it personal: it is judged against the user's instructions,
 * not against a generic reviewer.
 */
export function glancePrompt(input: GlanceInput): string {
  const topic = input.topic ? `It belongs to the topic "${input.topic.name}".` : '';
  return `You are helping a developer decide, at a glance, what to do about one GitHub pull request.
${viewerLine(input.viewer)}
${contextBlock(input.context)}
How the PR reached them: ${howItReached(input.provenance)} ${topic}

The pull request:
${prDetails(input.pr, input.viewer, fullDetail)}

Fields, each read at a glance, so stay under the word limits:
- verdict: LOOKS_SAFE means a reasonable reviewer could approve from this summary alone.
  LOOK_CLOSER means something deserves a real read first: open concerns, risky changes, or a
  description that does not explain the change. NOT_YOURS means the change is clearly outside
  what this user should sign off, judged by their instructions above.
- forYou: one or two sentences on what this PR means for this user specifically, written
  against their own instructions. Say what they should do. Max 40 words.
- does: what the PR does and why, plain words, max 30 words.
- risk: "low", "medium" or "high", then " - " and what could break, max 15 words.
- othersSaid: which humans weighed in and whether any concern is still open, max 25 words;
  "nobody yet" if no human commented.

Be concrete and skeptical; do not pad. Say "unclear" rather than invent.
${jsonOnly('{"verdict": "LOOKS_SAFE" | "LOOK_CLOSER" | "NOT_YOURS", "forYou": "...", "does": "...", "risk": "...", "othersSaid": "..."}')}`;
}
