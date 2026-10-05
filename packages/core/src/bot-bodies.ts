// Bot bodies are cut when a snapshot is saved (DESIGN.md "Bot bodies are
// cut when saved"). Bots write most of the comment text PostPile stores
// (review summaries, CI reports, preview tables), and the rules and prompts
// read little of it. A body a rule reads further stays whole. Rules only, no IO.
import { isBot, isMergeQueueBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import { isBotAuthor } from './pr-owners.ts';
import type { Comment, Pr, Review } from './types.ts';

/**
 * The longest bot body PostPile keeps, marker included, in UTF-16 code
 * units (a JS string's length; an emoji counts 2). A reply draft reads the
 * first 3,000 of the comment it answers (`REPLIED_TO_MAX`), and everything
 * else reads less, so the cut changes no prompt.
 */
export const BOT_BODY_MAX = 3072;

/** Ends a cut body. Plain words: no rule's pattern (bot markers, deploy, mentions, questions) matches it. */
export const TRIMMED_MARKER = '\n\n… (trimmed by PostPile)';

/** What decides whether a body is cut: who wrote it, who edited it last (null or missing: nobody, or GitHub did not say). */
export interface CuttableBody {
  author: string;
  body: string;
  editor?: string | null;
}

/**
 * A person other than the author edited it last. The edit event then reads
 * the whole body for mentions of the viewer (`editMentionOf`), so it stays
 * whole. Mirrors the "not automation" case of the edit rules in events.ts.
 */
function editedByPerson(item: CuttableBody): boolean {
  const editor = item.editor ?? null;
  return editor !== null && !sameLogin(editor, item.author) && !isBot(editor);
}

/**
 * Kept whole, however long: a person's body (a deleted author's too, who
 * may have been one), a merge queue bot's (`mergeQueueState` looks for its
 * markers anywhere in the body) and one a person edited last.
 */
function keptWhole(item: CuttableBody): boolean {
  return !isBotAuthor(item.author) || isMergeQueueBot(item.author) || editedByPerson(item);
}

/** A bot body longer than PostPile keeps, and no rule reads past the cut. */
export function isCutOnSave(item: CuttableBody): boolean {
  return item.body.length > BOT_BODY_MAX && !keptWhole(item);
}

/**
 * Where an HTML comment opens without closing in `text`, -1 when every one
 * closes. Reads them the way the rules strip them (`<!--` to the next
 * `-->`), so text cut there never leaves the rest looking like a comment.
 */
function unclosedHtmlComment(text: string): number {
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) {
      return -1;
    }
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      return open;
    }
    from = close + 3;
  }
}

/** A high surrogate: the first half of a character outside the BMP (most emoji). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The body as PostPile stores it: a bot's body longer than BOT_BODY_MAX
 * (`isCutOnSave`) is cut so that it fits with the marker. The cut never
 * splits a character and never leaves an HTML comment open (bots hide
 * state in them, and the rules only strip closed ones): it moves back to
 * before that comment. Anything else comes back as it is, and cutting
 * twice changes nothing.
 */
export function trimBotBody(item: CuttableBody): string {
  if (!isCutOnSave(item)) {
    return item.body;
  }
  let end = BOT_BODY_MAX - TRIMMED_MARKER.length;
  if (isHighSurrogate(item.body.charCodeAt(end - 1))) {
    end -= 1;
  }
  const head = item.body.slice(0, end);
  const open = unclosedHtmlComment(head);
  return `${open === -1 ? head : head.slice(0, open)}${TRIMMED_MARKER}`;
}

function trimmedComment(comment: Comment): Comment {
  const body = trimBotBody(comment);
  return body === comment.body ? comment : { ...comment, body };
}

/** A review's body is cut like its copy among the comments, which carries the editor. */
function reviewBody(review: Review, comments: Comment[]): CuttableBody {
  const editor = comments.find((comment) => comment.id === review.id)?.editor ?? null;
  return { author: review.author, body: review.body, editor };
}

function trimmedReview(review: Review, comments: Comment[]): Review {
  const body = trimBotBody(reviewBody(review, comments));
  return body === review.body ? review : { ...review, body };
}

function cutsSomething(pr: Pr): boolean {
  const comments = [...pr.comments, ...pr.threads.flatMap((thread) => thread.comments)];
  return comments.some(isCutOnSave) || pr.reviews.some((review) => isCutOnSave(reviewBody(review, pr.comments)));
}

/**
 * A stored snapshot with every bot body cut like a fresh fetch cuts it:
 * the flat comments, the comments inside review threads and the review
 * bodies (stored JSON holds each copy on its own). The same object when
 * nothing is cut, so callers can tell whether to write it back.
 */
export function trimBotBodies(pr: Pr): Pr {
  if (!cutsSomething(pr)) {
    return pr;
  }
  return {
    ...pr,
    comments: pr.comments.map(trimmedComment),
    threads: pr.threads.map((thread) => ({ ...thread, comments: thread.comments.map(trimmedComment) })),
    reviews: pr.reviews.map((review) => trimmedReview(review, pr.comments)),
  };
}
