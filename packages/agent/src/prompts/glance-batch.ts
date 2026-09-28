import type { GlanceBatchInput } from '../service.ts';
import { renderDossier } from './dossier.ts';
import { batchDetail, contextBlock, GITHUB_DATA_RULE, howItReached, jsonOnly, prDetails, viewerLine, workContextBlock } from './shared.ts';

function topicBlock(input: GlanceBatchInput): string {
  if (!input.topic) {
    return 'These PRs are not sorted into any topic yet.';
  }
  const prs = new Map(input.items.map((item) => [item.pr.key, item.pr]));
  const dossier = input.dossier ? renderDossier(input.dossier, prs) : `No dossier yet. ${input.topic.summary}`;
  return `They all belong to the topic "${input.topic.name}". What is known about that work:\n\n${dossier}`;
}

/**
 * The "approve at a glance" summary for up to GLANCE_BATCH_SIZE PRs of one
 * topic in one call. The dossier and the user's memory are sent once; each PR
 * is read against them. Same fields and word limits as the single glance.
 */
export function glanceBatchPrompt(input: GlanceBatchInput): string {
  const sections = input.items
    .map((item) => `=== ${item.pr.key}\nHow it reached them: ${howItReached(item.provenance)}\n${prDetails(item.pr, input.viewer, batchDetail)}`)
    .join('\n\n');
  return `You are helping a developer decide, at a glance, what to do about each of ${input.items.length} GitHub pull requests.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
${topicBlock(input)}

The pull requests, each headed by its key:

${sections}

For every pull request above give one entry, with its key as prKey. Fields, each read at a glance,
so stay under the word limits:
- verdict: LOOKS_SAFE means a reasonable reviewer could approve from this summary alone.
  LOOK_CLOSER means something deserves a real read first: open concerns, risky changes, or a
  description that does not explain the change. NOT_YOURS means the change is clearly outside
  what this user should sign off, judged by their instructions above.
- forYou: one or two sentences on what this PR means for this user specifically, written
  against their own instructions and what they care about in this topic. Say what they should
  do. Max 40 words.
- does: what the PR does and why, and its part in the topic when that helps, max 30 words.
- risk: "low", "medium" or "high", then " - " and what could break, max 15 words.
- othersSaid: which humans weighed in and whether any concern is still open, max 25 words;
  "nobody yet" if no human commented.

Judge each PR on its own facts; do not copy one PR's verdict to the next. Be concrete and
skeptical; say "unclear" rather than invent.
${jsonOnly('{"glances": [{"prKey": "owner/repo#1", "verdict": "LOOKS_SAFE" | "LOOK_CLOSER" | "NOT_YOURS", "forYou": "...", "does": "...", "risk": "...", "othersSaid": "..."}]}')}`;
}
