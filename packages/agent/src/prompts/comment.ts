import type { DraftCommentInput } from '../service.ts';
import { contextBlock, fullDetail, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prDetails, viewerLine } from './shared.ts';

/** "Ask <person>": who the comment speaks to, what to ask, and its shape. */
function askLines(person: string, intent: string): { audience: string; shape: string } {
  const what = intent
    ? `What the user wants to ask, in their own words: ${intent}`
    : 'The user did not say what to ask. Pick the most useful open question for this person.';
  return {
    audience: `The comment is addressed to @${person}.\n${what}`,
    shape: `Write it the way the user would: short, direct, friendly, no filler, no sign-off. Start with
@${person}. GitHub markdown is fine. One question per comment unless they asked for more.`,
  };
}

/**
 * "Rewrite with the agent" on a review note: the user's own words, a gist or
 * a rough draft. Their text, so outside the fence; empty adds nothing.
 */
function gistLines(gist: string): string {
  if (gist === '') {
    return '';
  }
  return `\nWhat the user wants to say, in their own words (a gist or a rough draft):
${gist}
Write the note from it: keep their meaning and their points, fix the wording. Never add a point they did not make.`;
}

/**
 * A review note (Approve with comment, Comment review): addressed to nobody, the engine says what it is for.
 * Unlike an ask, nobody asked about CI here, and older glance notes may still carry stale CI status: NO_CI_RULE.
 */
function reviewNoteLines(intent: string, gist: string): { audience: string; shape: string } {
  return {
    audience: `The comment is the body of the user's review, addressed to nobody in particular.\n${intent}${gistLines(gist)}`,
    shape: `Write it the way the user would, as plain sentences: active voice, present tense, each under 25 words.
No hedging ("I think", "it seems", "just"), no idioms, no em dashes, no greeting, no sign-off, no headings or
bullets. Keep real identifiers and file paths, in backticks.
${NO_CI_RULE}`,
  };
}

/** Earlier-read lines for the draft, fenced like other GitHub-derived text. Empty without notes. */
function notesBlock(notes: string[]): string {
  if (notes.length === 0) {
    return '';
  }
  return `\nWhat PostPile's earlier read of this PR said (a summary, may predate the newest commits):\n${githubData(notes.join('\n'))}\n`;
}

/** "Ask <person>" or a review note: a PR comment the user edits before it is sent. Never sent by the agent. */
export function draftCommentPrompt(input: DraftCommentInput): string {
  const intent = input.intent.trim();
  const lines = input.person === null ? reviewNoteLines(intent, input.gist?.trim() ?? '') : askLines(input.person, intent);
  return `You are drafting a GitHub PR comment that the user will edit and post themselves.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
${lines.audience}
${notesBlock(input.notes ?? [])}
The pull request:
${prDetails(input.pr, input.viewer, fullDetail)}

${lines.shape}
${jsonOnly('{"body": "..."}')}`;
}
