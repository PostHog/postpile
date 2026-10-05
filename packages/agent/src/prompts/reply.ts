import type { Comment } from '@postpile/core';
import type { DraftReplyInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prLine, viewerLine } from './shared.ts';

const CONVERSATION_COMMENT_MAX = 1200;
const REPLIED_TO_MAX = 3000;

function conversationLine(comment: Comment, repliedToId: string): string {
  const marker = comment.id === repliedToId ? ' [the comment to answer]' : '';
  return `@${comment.author}${marker}: ${clip(comment.body, CONVERSATION_COMMENT_MAX)}`;
}

/** Where the comment sits: an inline thread on a file, or the PR conversation. */
function whereLine(comment: Comment): string {
  if (comment.kind === 'review_comment') {
    return `It is an inline review comment on ${comment.path ?? 'a file'}; the reply goes into its review thread.`;
  }
  return 'It is in the PR conversation; the reply is posted as a new PR comment below it, quoting it.';
}

/** Draft from the conversation alone, or from the user's own words. The gist is the user's text, so it stays outside the fence. */
function whatLines(gist: string): string {
  if (gist === '') {
    return 'The user did not say what to answer. Write the most useful reply to the comment, from the conversation.';
  }
  return `What the user wants to say, in their own words (a gist or a rough draft):
${gist}
Write the reply from it: keep their meaning, their points and their decisions. Fix wording and order,
fill in only what the conversation makes obvious, never add a point, promise or question they did not make.`;
}

/**
 * A reply to one human comment on a PR, which the user edits and posts
 * themselves. Never sent by the agent. The comment and its conversation are
 * GitHub text, fenced.
 */
export function draftReplyPrompt(input: DraftReplyInput): string {
  const conversation = input.conversation.map((comment) => conversationLine(comment, input.comment.id)).join('\n\n');
  const notes = input.notes.length > 0 ? `\nWhat PostPile's earlier read of this PR said (a summary, may predate the newest commits):\n${githubData(input.notes.join('\n'))}\n` : '';
  return `You are drafting a reply to one comment on a GitHub pull request. The user edits it and posts it themselves.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
The pull request:
${githubData(prLine(input.pr))}
${notes}
The comment to answer, by @${input.comment.author}:
${githubData(clip(input.comment.body, REPLIED_TO_MAX))}
${whereLine(input.comment)}

The conversation around it, oldest first:
${githubData(conversation)}

${whatLines(input.gist.trim())}

Write it the way the user would: short, direct, friendly, no filler, no greeting, no sign-off. Answer
what the comment asks or says; when the conversation already settled it, say so in a line. Plain
sentences, GitHub markdown only where it helps (code in backticks). Do not quote the comment and do
not start with an @mention: PostPile adds both where they are needed.
${NO_CI_RULE}
${jsonOnly('{"body": "..."}')}`;
}
