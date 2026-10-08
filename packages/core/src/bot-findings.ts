// What a bot's change request found, in one line, next to "Address
// <bot>'s changes". A bot's review often asks for something no code change
// gives (an org admin granting a team access, say), and the move alone
// does not say so. Taken from the stored review text by rules, no agent
// call: the first sentence of the first plain text line, else the first
// heading. DESIGN.md "Stacks land together" › Bot change requests.
import { isBot } from './bots.ts';
import { stripHtmlComments } from './html-comments.ts';
import { sameLogin } from './mentions.ts';
import { changesRequestedByAll } from './review-request.ts';
import type { FullComment, FullPr, FullReview } from './types.ts';

/** The longest finding line, in characters, "…" included. */
export const FINDING_MAX = 120;

/** A bot's standing change request and what it found. */
export interface BotFinding {
  /** The bot's login, as GitHub names the reviewer. */
  by: string;
  /** One line from its review text, markdown stripped (`findingLine`). */
  summary: string;
}

/** The text without fenced code blocks; an unclosed fence hides the rest. Line by line, no regex over the whole text. */
function withoutCodeBlocks(text: string): string {
  const kept: string[] = [];
  let inCode = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode;
    } else if (!inCode) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

/**
 * Markdown and HTML that never carry the finding: comments, code blocks,
 * tags, images (badges), and the link around them. Each pattern's middle
 * excludes its own opener ("<", "[", "("), so a text full of openers is
 * still read in linear time (GitHub text is anyone's input).
 */
function stripMarkup(text: string): string {
  return withoutCodeBlocks(stripHtmlComments(text))
    .replace(/<[^<>]+>/g, ' ')
    .replace(/!\[[^[\]]*\]\([^()]*\)/g, '')
    .replace(/\[\s*\]\([^()]*\)/g, '')
    .replace(/\[([^[\]]*)\]\([^()]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '');
}

/** One line without its markdown: heading marks, quotes, list bullets, emphasis and code ticks. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A line worth showing: some letters, not a table row or a rule. */
function hasWords(line: string): boolean {
  return /\p{L}{2,}/u.test(line) && !line.startsWith('|') && !/^[-=_*\s]+$/.test(line);
}

/** The first sentence of a line: up to the first ".", "!" or "?" before a space, or the whole line. */
function firstSentence(line: string): string {
  const end = line.search(/[.!?](\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

/** Cut at a word boundary to `max` characters with "…". */
function capped(line: string, max: number = FINDING_MAX): string {
  if (line.length <= max) {
    return line;
  }
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The finding in a review body, in one line: the first sentence of the
 * first plain text line, else of the first heading (a bot's title says
 * less than its first sentence), with markdown, links and badges removed,
 * at most `FINDING_MAX` characters. Null when nothing with words is left.
 */
export function findingLine(body: string, max: number = FINDING_MAX): string | null {
  const lines = stripMarkup(body).split('\n');
  const isHeading = (line: string) => /^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(line);
  const text = lines.find((line) => !isHeading(line) && hasWords(plainLine(line)));
  const heading = lines.find((line) => isHeading(line) && hasWords(plainLine(line)));
  const chosen = text ?? heading;
  return chosen === undefined ? null : capped(firstSentence(plainLine(chosen)), max);
}

/**
 * The first line of an inline finding: its first line with words, heading
 * or not (a bot's inline comment leads with the finding itself), first
 * sentence, at most `max` characters.
 */
function inlineFindingLine(body: string, max: number): string | null {
  const line = stripMarkup(body)
    .split('\n')
    .find((candidate) => hasWords(plainLine(candidate)));
  return line === undefined ? null : capped(firstSentence(plainLine(line)), max);
}

/** Below this many characters a review line says too little to stand for the finding. */
const SHORT_LINE = 40;

/**
 * Review text that only points elsewhere: "findings inline", "details
 * below", "see the inline comments". Whole phrases only: a finding that
 * just uses the word ("Inline cache invalidation is broken") stays.
 */
const POINTS_ELSEWHERE = /\b(findings?|comments?|details?|issues?|notes?)( are)? (inline|below)\b|\binline (findings?|comments?)\b|\bsee (the )?(inline )?comments?\b/i;

/** A review body's line that says nothing of the finding itself: missing, short, or pointing at the inline comments. */
function saysLittle(line: string | null): boolean {
  return line === null || line.length < SHORT_LINE || POINTS_ELSEWHERE.test(line);
}

/**
 * The bot's inline comments that carry a review's findings, oldest first:
 * those naming the review (`Comment.reviewId`), else (a comment stored
 * without the id) the same bot's inline comments without one, posted at or
 * after the review. Never another author's.
 */
function inlineFindingsOf(review: FullReview, pr: FullPr): FullComment[] {
  const own = pr.comments
    .filter((comment) => comment.kind === 'review_comment' && sameLogin(comment.author, review.author))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const named = own.filter((comment) => comment.reviewId === review.id);
  if (named.length > 0) {
    return named;
  }
  // A stored row without the id can read as null rather than missing.
  return own.filter((comment) => (comment.reviewId ?? null) === null && comment.createdAt >= review.submittedAt);
}

/**
 * A change request's finding: the review text's line, unless it says
 * little ("Security review - findings inline."); then the first inline
 * comment's first line, with "(+N more)" for the other inline findings,
 * all within `FINDING_MAX`. Falls back to the review's own line.
 */
function changeRequestFinding(review: FullReview, pr: FullPr): string | null {
  const own = findingLine(review.body);
  if (!saysLittle(own)) {
    return own;
  }
  const inline = inlineFindingsOf(review, pr);
  const first = inline.findIndex((comment) => inlineFindingLine(comment.body, FINDING_MAX) !== null);
  if (first < 0) {
    return own;
  }
  const more = inline.length - 1;
  const suffix = more > 0 ? ` (+${more} more)` : '';
  return `${inlineFindingLine(inline[first]!.body, FINDING_MAX - suffix.length)}${suffix}`;
}

/**
 * Each bot whose standing review asks for changes (`changesRequestedByAll`,
 * the order whose turn names them in), with its newest change request's
 * finding (`changeRequestFinding`: its text, or its first inline comment
 * when the text only points there). Left out when neither has words.
 */
export function botFindings(pr: FullPr): BotFinding[] {
  const findings: BotFinding[] = [];
  for (const login of changesRequestedByAll(pr).filter((reviewer) => isBot(reviewer))) {
    const requests = pr.reviews
      .filter((review) => review.state === 'CHANGES_REQUESTED' && sameLogin(review.author, login))
      .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const newest = requests.at(-1);
    const summary = newest === undefined ? null : changeRequestFinding(newest, pr);
    if (summary !== null) {
      findings.push({ by: login, summary });
    }
  }
  return findings;
}
