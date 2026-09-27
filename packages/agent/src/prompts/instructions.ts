import type { InstructionsChangeInput } from '../service.ts';
import { clip, jsonOnly } from './shared.ts';

/** Longest instructions text the app accepts back; well above anything a person writes by hand. */
export const INSTRUCTIONS_MAX_CHARS = 20_000;
/** A change summary is one line in the version history. */
export const INSTRUCTIONS_SUMMARY_MAX = 160;

function earlierBlock(messages: string[]): string {
  if (messages.length === 0) {
    return '';
  }
  const lines = messages.slice(-5).map((message) => `- ${clip(message, 500)}`);
  return `\nTheir earlier messages in this chat, oldest first (context only):\n${lines.join('\n')}\n`;
}

/**
 * Rewrites the user's general instructions from one of their own messages.
 * The prompt carries no GitHub text on purpose: it rewrites what shapes
 * every other prompt, so only the user's words may go in. The answer is a
 * proposal; the user sees it as a diff and accepts, edits or rejects it.
 */
export function instructionsChangePrompt(input: InstructionsChangeInput): string {
  const current = input.instructions.trim() || '(empty: the user has not written any yet)';
  return `You keep the general instructions a developer gives their code review inbox assistant.
The instructions are theirs, in their words. Everything below comes from the user themselves.

Current instructions:
<instructions>
${current}
</instructions>
${earlierBlock(input.earlierMessages)}
Their message:
${clip(input.message, 2000)}

If the message asks for a lasting change to how the assistant works across all their topics,
write the full new instructions text:
- change only what the message asks for; keep every other line word for word, in the same order
- add a new point where it fits their structure; edit a line when the message changes it; remove
  a line only when the message asks for that
- keep their voice and formatting (headings, bullets)
"summary" says in one short line what changed, max ${INSTRUCTIONS_SUMMARY_MAX} chars.
If the message does not ask for such a change (a question, a one-off, a point about one topic),
"change" is null and "reply" says in one sentence why.
${jsonOnly('{"reply": "...", "change": {"text": "...full new instructions...", "summary": "..."} | null}')}`;
}
