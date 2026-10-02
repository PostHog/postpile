import { LESSON_TEXT_MAX, type LessonGlance, type LessonReview } from '@postpile/core';
import type { LessonInstructionsInput, LessonWriteInput, LessonWriteItem } from '../service.ts';
import { INSTRUCTIONS_SUMMARY_MAX } from './instructions.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prLine, viewerLine } from './shared.ts';

const MISMATCH_TEXT = {
  safety: 'The glance said LOOKS_SAFE, yet the user requested changes.',
  risk: 'The glance said LOOK_CLOSER but rated the risk low, and the user requested changes.',
  relevance: 'The glance said NOT_YOURS (outside what the user signs off), yet the user reviewed it and requested changes.',
} as const;

function glanceText(glance: LessonGlance): string {
  return `verdict ${glance.verdict}; risk: ${clip(glance.risk, 200)}; for the user: ${clip(glance.forYou, 300)}; does: ${clip(glance.does, 300)}`;
}

function reviewText(review: LessonReview): string {
  const body = review.body.trim() ? clip(review.body, 1500) : '(no text in the review body)';
  const comments = review.comments.slice(0, 12).map((comment) => `- ${comment.path ?? '(no file)'}: ${clip(comment.body, 400)}`);
  return comments.length === 0 ? `Review: ${body}` : `Review: ${body}\nInline comments:\n${comments.join('\n')}`;
}

/** One item: the PR and the glance as data, the review fenced as GitHub text, a taught note as the user's own words. */
function itemBlock(item: LessonWriteItem): string {
  const lines = [`=== L${item.id}`];
  if (item.mismatch) {
    lines.push(MISMATCH_TEXT[item.mismatch]);
  }
  // The PR line and the glance were written from GitHub text: fenced like it.
  const data = [`PR: ${prLine(item.pr)}`];
  if (item.glance) {
    data.push(`What the glance said before: ${glanceText(item.glance)}`);
  }
  // The review is the user's, but it travels through GitHub and can quote anyone: fenced too.
  if (item.review) {
    data.push(reviewText(item.review));
  }
  lines.push(githubData(data.join('\n')));
  if (item.note.trim()) {
    lines.push(`The user's own words, typed into PostPile: ${clip(item.note, 1000)}`);
  }
  return lines.join('\n');
}

function knownLinesBlock(input: LessonWriteInput): string {
  const open = input.open.map((lesson) => `- L${lesson.id}: ${lesson.text}`);
  const dismissed = input.dismissed.map((text) => `- ${text}`);
  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(`Lines already waiting for the user in this topic (answer sameAs with their id when an item says the same):\n${open.join('\n')}`);
  }
  if (dismissed.length > 0) {
    parts.push(`Lines the user turned down. Never write these again, not even reworded:\n${dismissed.join('\n')}`);
  }
  return parts.length === 0 ? '' : `\n${parts.join('\n\n')}\n`;
}

/**
 * Turns the user's pushback into candidate lines for future glances. Each
 * item is a change request on a PR the glance let through, or the user's
 * own words from "Teach future assessments". The answer is a candidate
 * only; the user decides if and where it applies.
 */
export function lessonWritePrompt(input: LessonWriteInput): string {
  const topic = input.topic ? `They all belong to the topic ${githubData(input.topic.name)}.` : 'These PRs are not sorted into a topic yet.';
  return `You help a developer teach their code review assistant what to check on future pull requests.
The assistant writes a "glance" per PR: LOOKS_SAFE, LOOK_CLOSER or NOT_YOURS, with a risk level.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
${topic}

Each item below is a time the glance did not match the user's judgement.
${input.items.map(itemBlock).join('\n\n')}
${knownLinesBlock(input)}
For each item, decide whether it holds a lesson for future glances:
- A lesson is one reusable condition and what to do about it, in the form "When <condition>, <what
  to check or how to judge>". Example: "When core code imports from ee/, say LOOK_CLOSER and name
  the import." Max ${LESSON_TEXT_MAX} characters.
- The condition must be supported by what the user wrote: their review, inline comments or their
  own words. Do not widen it into a policy they did not state ("This drops the backfill" supports
  "When a migration drops or rewrites data, check for a backfill plan", not "Look closer at every
  migration").
- No lesson (text null) for nits, typos, naming, style the instructions already cover, a review
  with no reason in it, or a one-off about this PR only. Most change requests hold no lesson; that
  is fine.
- When the lesson is already in the user's instructions or topic instructions above, text null.
- When it says the same as a line already waiting, give that line's id as sameAs (number only) and
  text null.
- "why" says in one short sentence why there is or is not a lesson.
Give one entry per item, its number from "=== L<id>" as id.
${jsonOnly('{"lessons": [{"id": 12, "text": "When ..., ..." | null, "sameAs": 7 | null, "why": "..."}]}')}`;
}

/**
 * "Use across topics" on a lesson: the instructions with this one line
 * added. The lesson was written by the agent from the user's review, and the
 * user chose it; the review goes along fenced, as context for where the
 * line fits. Only additions are accepted back (onlyAddsLesson).
 */
export function lessonInstructionsPrompt(input: LessonInstructionsInput): string {
  const current = input.instructions.trim() || '(empty: the user has not written any yet)';
  const evidence = input.evidence.trim() ? `\nWhere the lesson came from, as context only:\n${githubData(input.evidence)}\n${GITHUB_DATA_RULE}\n` : '';
  return `You keep the general instructions a developer gives their code review inbox assistant.
The instructions are theirs, in their words.

Current instructions:
<instructions>
${current}
</instructions>

The user chose to keep this lesson for all their topics:
${clip(input.lesson, 400)}
${evidence}
Write the full new instructions text with this lesson added:
- add it as one point (at most a few lines) where it fits their structure, in their voice and
  formatting (headings, bullets)
- keep every existing line word for word, in the same order; change and remove nothing
- add nothing else
"summary" says in one short line what was added, max ${INSTRUCTIONS_SUMMARY_MAX} chars.
If the instructions already say this, "change" is null and "reply" says where.
${jsonOnly('{"reply": "...", "change": {"text": "...full new instructions...", "summary": "..."} | null}')}`;
}
