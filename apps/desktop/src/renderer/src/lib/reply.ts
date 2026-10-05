// The composer's words for a reply to a person's comment. Which comment can
// take a reply, and where it goes, comes from core (`ActivityLine.reply`).
import type { LineReply } from '@postpile/core';

/** "ci.yml" from ".github/workflows/ci.yml". */
function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export interface ReplyCopy {
  title: string;
  /** Where it lands, after the title. */
  hint: string;
  submit: string;
}

/** The composer's words for a reply: where it goes, and a button that names the target. */
export function replyCopy(target: LineReply): ReplyCopy {
  if (target.inThread && target.path) {
    return { title: 'Reply in thread', hint: `on ${fileName(target.path)}`, submit: 'Post reply in thread' };
  }
  return { title: `Reply to ${target.author}`, hint: 'new PR comment, quotes their line', submit: `Post reply to ${target.author}` };
}
