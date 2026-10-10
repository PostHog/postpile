/**
 * Stand-ins for the agent placing a user's point in their instructions: by
 * keywords, under the heading it is about, and noticing a line that already
 * says it. The real app asks the agent (instructions chat, setup_refine);
 * sample data only needs to land the line where a reader would expect it.
 */

/** Keyword rules in order; the first whose pattern matches and whose heading exists wins. */
const PLACEMENT_RULES: { pattern: RegExp; headings: string[] }[] = [
  {
    pattern: /\b(ignore|skip|quiet|mute|noise|not mine|isn't mine|don't care|do not care)\b/,
    headings: ['What to ignore or keep quiet', 'What to skip'],
  },
  { pattern: /\b(own|owns|owned|maintain|maintains)\b/, headings: ['What I own'] },
  { pattern: /\b(routed|codeowners|on behalf of)\b/, headings: ['What gets routed to me'] },
  { pattern: /\b(i work on|my role|i am|i'm)\b/, headings: ['About me'] },
];

/** Openers a written instruction does not need. */
const FILLER_OPENER = /^(from now on|going forward|in general|please)[,:]?\s+/i;

/** Words too common to tell two lines apart. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'me', 'my', 'i', 'to', 'is', 'it', 'of', 'and', 'or', 'when', 'something', 'about', 'please']);

/** How much two lines' words must overlap to count as saying the same. */
const DUPLICATE_OVERLAP = 0.7;

/** "From now on, tell me X" -> "Tell me X.": no bullet, no filler opener, capitalised and finished. */
export function cleanPoint(text: string): string {
  const bare = text.trim().replace(/^[-*]\s*/, '').replace(FILLER_OPENER, '');
  const sentence = `${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The heading a point is about, among `headings`, or `fallback` when no rule fits. */
export function headingFor(point: string, headings: string[], fallback: string): string {
  const words = point.toLowerCase();
  for (const rule of PLACEMENT_RULES) {
    const heading = rule.headings.find((candidate) => headings.includes(candidate));
    if (heading && rule.pattern.test(words)) {
      return heading;
    }
  }
  return fallback;
}

function keyWords(line: string): Set<string> {
  const words = line.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return new Set(words.filter((word) => word !== '' && !STOP_WORDS.has(word)));
}

/** The existing bullet line that says nearly the same as `point`, or null. */
export function nearDuplicate(text: string, point: string): string | null {
  const wanted = keyWords(point);
  if (wanted.size === 0) {
    return null;
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    if (line === '' || raw.trimStart().startsWith('#')) {
      continue;
    }
    const have = keyWords(line);
    const shared = [...wanted].filter((word) => have.has(word)).length;
    if (shared / Math.max(wanted.size, have.size) >= DUPLICATE_OVERLAP) {
      return line;
    }
  }
  return null;
}

/** The markdown headings of an instructions text ("# What to skip" -> "What to skip"). */
function headingsOf(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const match = /^#+\s+(.*)$/.exec(line);
    return match ? [match[1]!.trim()] : [];
  });
}

/**
 * The instructions text with `- point` as the last line under the heading it
 * fits (`fallback` when none fits). Without that heading the line goes at
 * the end, as before.
 */
export function withPointPlaced(text: string, point: string, fallback: string): { text: string; heading: string | null } {
  const lines = text.trimEnd().split('\n');
  const heading = headingFor(point, headingsOf(lines), fallback);
  const start = lines.findIndex((line) => /^#+\s+/.test(line) && line.replace(/^#+\s+/, '').trim() === heading);
  if (start < 0) {
    return { text: `${text.trimEnd()}\n- ${point}\n`.trimStart(), heading: null };
  }
  const nextHeading = lines.findIndex((line, index) => index > start && /^#+\s+/.test(line));
  let insertAt = nextHeading < 0 ? lines.length : nextHeading;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === '') {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, `- ${point}`);
  return { text: `${lines.join('\n')}\n`, heading };
}
