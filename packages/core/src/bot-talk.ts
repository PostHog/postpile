// Bot talk: what people and bots say to bots, which no agent needs to read.
// Bots' own comments were always left out of agent work (`isMachineComment`).
// People's half of the conversation was not: a "fixed" to a review bot, an
// "@codex review" or "/trunk merge", and the empty review GitHub wraps every
// thread reply in. On a busy inbox that was most of what counted as human
// discussion, and each one re-ran a glance, started a dossier update or went
// to the events agent. DESIGN.md "Bot talk leaves agent work".
import { isBotThreadReply } from './bot-threads.ts';
import { isBot, isMachineComment } from './bots.ts';
import { isCarrierReview } from './carrier-reviews.ts';
import type { Comment, Pr, Review } from './types.ts';

/** A command is one short line: the command and a few words for it ("@greptileai review this again"). */
const COMMAND_MAX_WORDS = 6;

/**
 * Bot handles people type that are not bot logins: Codex answers to
 * "@codex", the Claude app to "@claude", Cursor to "@cursor", Mergify to
 * "@mergify". `isBot` covers the rest ("@coderabbitai", "@greptileai",
 * "@dependabot", "@copilot").
 */
const COMMAND_HANDLES = /^(codex|claude|cursor|mergify)$/i;

/** "@codex review", "@dependabot rebase": the first word names a bot. "@acme/team" is a team, not a handle. */
const leadingHandle = /^@([a-z0-9][a-z0-9-]*(?:\[bot\])?)(?=\s|$)/i;

/** "/trunk merge", "/approve": a slash command. "/usr/local/bin is wrong" is a path, not a command. */
const leadingSlashCommand = /^\/[a-z][\w-]*(?=\s|$)/i;

/** Every @handle in the text, teams too ("acme/devex"). */
const anyHandle = /@([a-z0-9][a-z0-9-]*(?:\[bot\])?(?:\/[a-z0-9_.-]+)?)/gi;

function isBotHandle(handle: string): boolean {
  return isBot(handle) || COMMAND_HANDLES.test(handle);
}

/**
 * A person's comment that only tells a bot what to do: one short line that
 * starts with a slash command or an @-mention of a bot, and mentions nobody
 * else. "@codex review", "/trunk merge", "@coderabbitai full review". Kept
 * narrow on purpose: a question that names @codex mid-sentence, a second
 * line of explanation, or "@alice can you /approve" stay people's
 * discussion. A comment left without its body (`null`) is not one.
 */
export function isBotCommand(comment: Pick<Comment, 'body'>): boolean {
  const text = (comment.body ?? '').trim();
  if (text === '' || text.includes('\n') || text.split(/\s+/).length > COMMAND_MAX_WORDS) {
    return false;
  }
  const handle = leadingHandle.exec(text)?.[1];
  const addressesBot = handle === undefined ? leadingSlashCommand.test(text) : isBotHandle(handle);
  if (!addressesBot) {
    return false;
  }
  const handles = [...text.matchAll(anyHandle)].map((match) => match[1]!);
  return handles.every(isBotHandle);
}

/**
 * A person talking to a bot: a bot command (`isBotCommand`) or a reply in a
 * review thread where only bots spoke before (`isBotThreadReply`). Never an
 * answer to a person: it is no touch, no reply to a changes request and no
 * last word in a thread (DESIGN.md "Bot talk leaves agent work").
 */
export function talksToBot(comment: Comment, pr: Pr): boolean {
  return isBotCommand(comment) || isBotThreadReply(comment, pr);
}

/**
 * Talk with or by bots, never human discussion: a bot's comment
 * (`isMachineComment`) or a person talking to a bot (`talksToBot`). Asks of
 * the viewer are decided per viewer by their event kinds (a mention stays
 * a mention); this rule is the same for everyone, so prompts and input
 * hashes can use it.
 */
export function isBotTalk(comment: Comment, pr: Pr): boolean {
  return isMachineComment(comment) || talksToBot(comment, pr);
}

/** The PR's human discussion, oldest first: every comment that is not bot talk (`isBotTalk`). */
export function humanDiscussion(pr: Pr): Comment[] {
  return pr.comments.filter((comment) => !isBotTalk(comment, pr));
}

/**
 * People's reviews: not a bot's, and not the empty review GitHub made to
 * carry thread replies (`isCarrierReview`): the replies are comments of
 * their own, the wrapper says nothing.
 */
export function humanReviews(pr: Pr): Review[] {
  return pr.reviews.filter((review) => !isBot(review.author) && !isCarrierReview(review, pr));
}
