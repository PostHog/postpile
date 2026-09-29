import type { GlanceBatchInput } from '../service.ts';
import { renderDossier } from './dossier.ts';
import { batchDetail, contextBlock, GITHUB_DATA_RULE, githubData, howItReached, jsonOnly, prDetails, viewerLine, workContextBlock } from './shared.ts';

function topicBlock(input: GlanceBatchInput): string {
  if (!input.topic) {
    return 'These PRs are not sorted into any topic yet.';
  }
  const prs = new Map(input.items.map((item) => [item.pr.key, item.pr]));
  const dossier = input.dossier ? renderDossier(input.dossier, prs) : `No dossier yet. ${input.topic.summary}`;
  // Topic name and dossier are written from GitHub text: fenced as data.
  return `They all belong to one topic. Its name and what is known about that work:\n\n${githubData(`Topic: ${input.topic.name}\n\n${dossier}`)}`;
}

/** On the retry batch: the first answer for these PRs could not be used. */
function retryNote(input: GlanceBatchInput): string {
  if (input.attempt !== 2) {
    return '';
  }
  return `\nA first answer for these pull requests could not be used: an entry was left out, a field was
missing, or the verdict was misspelled. Check each entry against the shape below before replying.`;
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
- keyFiles: up to 3 files a reviewer should open first, most important first, each as
  {"path", "why"}. Pick only from the PR's "Changed files" above and copy the path exactly;
  why is max 12 words (what to look for there). Give [] when the PR is trivial or lists no files.

"Approved by" marks each approver as a person or an agent (an AI review agent or other
automation account). Both are real approvals on GitHub. Who looked is a fact you may use in the
verdict, forYou or risk, for example whether a person has reviewed a change in the user's areas.

Judge each PR on its own facts; do not copy one PR's verdict to the next. Be concrete and
skeptical; say "unclear" rather than invent.
Give exactly ${input.items.length} ${input.items.length === 1 ? 'entry' : 'entries'}, one per pull request above, also for the user's own
PRs and drafts. Copy each prKey exactly as it appears after "===", and spell the verdict exactly
as one of LOOKS_SAFE, LOOK_CLOSER, NOT_YOURS.${retryNote(input)}
${jsonOnly('{"glances": [{"prKey": "owner/repo#1", "verdict": "LOOKS_SAFE" | "LOOK_CLOSER" | "NOT_YOURS", "forYou": "...", "does": "...", "risk": "...", "othersSaid": "...", "keyFiles": [{"path": "src/app.ts", "why": "..."}]}]}')}`;
}
