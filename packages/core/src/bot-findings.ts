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
import type { FullPr } from './types.ts';

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

/** Markdown and HTML that never carry the finding: comments, code blocks, tags, images (badges), and the link around them. */
function stripMarkup(text: string): string {
  return withoutCodeBlocks(stripHtmlComments(text))
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
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

/** Cut at a word boundary to `FINDING_MAX` with "…". */
function capped(line: string): string {
  if (line.length <= FINDING_MAX) {
    return line;
  }
  const cut = line.slice(0, FINDING_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > FINDING_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The finding in a review body, in one line: the first sentence of the
 * first plain text line, else of the first heading (a bot's title says
 * less than its first sentence), with markdown, links and badges removed,
 * at most `FINDING_MAX` characters. Null when nothing with words is left.
 */
export function findingLine(body: string): string | null {
  const lines = stripMarkup(body).split('\n');
  const isHeading = (line: string) => /^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(line);
  const text = lines.find((line) => !isHeading(line) && hasWords(plainLine(line)));
  const heading = lines.find((line) => isHeading(line) && hasWords(plainLine(line)));
  const chosen = text ?? heading;
  return chosen === undefined ? null : capped(firstSentence(plainLine(chosen)));
}

/**
 * Each bot whose standing review asks for changes (`changesRequestedByAll`,
 * the order whose turn names them in), with its newest change request's
 * finding. Left out when that review has no text with words.
 */
export function botFindings(pr: FullPr): BotFinding[] {
  const findings: BotFinding[] = [];
  for (const login of changesRequestedByAll(pr).filter((reviewer) => isBot(reviewer))) {
    const requests = pr.reviews
      .filter((review) => review.state === 'CHANGES_REQUESTED' && sameLogin(review.author, login))
      .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const newest = requests.at(-1);
    const summary = newest === undefined ? null : findingLine(newest.body);
    if (summary !== null) {
      findings.push({ by: login, summary });
    }
  }
  return findings;
}
