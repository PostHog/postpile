// scouts.md (DESIGN.md "Scouts"): the user's own file next to
// instructions.md. Each scout pulls PRs from outside the GitHub inbox into
// PostPile when they match its prompt. Rules only, no IO.
//
//   ## Lookout · structure
//   id: lookout-structure            (optional, else the slug of the name)
//   repos: acme/app, acme/infra      (required)
//   paths: +*/ (new top-level folder), +services/*/api/**, docs/architecture.md
//
//   Pull in PRs that change how the app is shaped: ...
//
// Text before the first "## " heading is a free intro and ignored. Key lines
// come right after the heading (blank lines between them are fine); the
// first other line starts the prompt, which runs to the next "## ".
import { codeownersPatternRegex } from './codeowners.ts';
import { globPathMatches } from './glob-match.ts';

/** One `paths:` entry. */
export interface ScoutPathHint {
  /** As written, without the "+" and the note in brackets: "services/*\/api/**". */
  pattern: string;
  /** "+" in front: only an added (or renamed-to) file counts. */
  addedOnly: boolean;
  /** "+*\/": a file in a top-level folder the PR's base does not have yet. */
  newTopLevelFolder: boolean;
}

/**
 * Whether a repo path matches the hint's CODEOWNERS-style pattern
 * (`globPathMatches`, no regex: hints can come from the model, and a regex
 * of theirs could backtrack for seconds). Never for `newTopLevelFolder`,
 * which the base tree decides.
 */
export function scoutHintMatches(hint: ScoutPathHint, path: string): boolean {
  return !hint.newTopLevelFolder && globPathMatches(hint.pattern, path);
}

export interface ScoutConfig {
  /** Stable id: the `id:` line, else the slug of the name. Cursors, judgements and pulls hang off it. */
  id: string;
  /** The heading, as written. */
  name: string;
  /** "owner/name", as written, each once. */
  repos: string[];
  /** Empty: every candidate goes to the model once. */
  paths: ScoutPathHint[];
  /** The body text: what the scout looks for. */
  prompt: string;
}

export interface ScoutsParse {
  /** In file order: an earlier scout wins a PR two scouts would pull. */
  scouts: ScoutConfig[];
  /** "line 4: …" each. Any error makes the whole file invalid: the last valid version stays active. */
  errors: string[];
}

const KEY_LINE = /^(id|repos|paths)\s*:\s*(.*)$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Lookout · structure" -> "lookout-structure". Accents dropped, anything else not a letter or digit becomes one dash. */
export function scoutSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The entry without a note in brackets at its end: "+*\/ (new top-level
 * folder)" -> "+*\/". Plain string handling: a regex here ran in polynomial
 * time on long runs of spaces (CodeQL js/polynomial-redos).
 */
function withoutNote(entry: string): string {
  const trimmed = entry.trim();
  const open = trimmed.lastIndexOf('(');
  if (!trimmed.endsWith(')') || open < 0) {
    return trimmed;
  }
  return trimmed.slice(0, open).trim();
}

/** One `paths:` entry, or an error message. */
function parsePathHint(entry: string): ScoutPathHint | string {
  const bare = withoutNote(entry);
  const addedOnly = bare.startsWith('+');
  const pattern = addedOnly ? bare.slice(1).trim() : bare;
  if (pattern === '') {
    return `empty path entry "${entry}"`;
  }
  if (addedOnly && pattern === '*/') {
    return { pattern, addedOnly, newTopLevelFolder: true };
  }
  // The regex only tells a pattern GitHub skips; matching never uses it (`scoutHintMatches`).
  if (codeownersPatternRegex(pattern) === null) {
    return `path "${pattern}" uses "!", "[ ]" or "\\", which paths do not support`;
  }
  return { pattern, addedOnly, newTopLevelFolder: false };
}

/** Comma-separated; whitespace too for repos, which never hold spaces. */
function listItems(value: string, splitOnSpace: boolean): string[] {
  return value
    .split(splitOnSpace ? /[,\s]+/ : ',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

interface Section {
  name: string;
  /** 1-based line of the heading. */
  line: number;
  lines: string[];
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && char.trim() === '';
}

/**
 * The name of a "## Name" heading line, or null for any other line ("###"
 * included). An optional closing run of "#" after a space is dropped, as in
 * Markdown. Plain string handling: the regex this replaced ran in
 * polynomial time on "## " followed by many spaces (CodeQL
 * js/polynomial-redos).
 */
function headingName(raw: string): string | null {
  if (!raw.startsWith('##') || raw.startsWith('###') || !isSpace(raw[2])) {
    return null;
  }
  const name = raw.slice(2).trim();
  let end = name.length;
  while (end > 0 && name[end - 1] === '#') {
    end -= 1;
  }
  if (end === name.length || (end > 0 && !isSpace(name[end - 1]))) {
    return name;
  }
  return name.slice(0, end).trim();
}

function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const name = headingName(raw);
    if (name !== null) {
      current = { name, line: index + 1, lines: [] };
      sections.push(current);
      return;
    }
    current?.lines.push(raw);
  });
  return sections;
}

/** One scout from its section; errors go to `errors`, prefixed with the line. */
function parseSection(section: Section, errors: string[]): ScoutConfig | null {
  const before = errors.length;
  const fail = (offset: number, message: string) => errors.push(`line ${section.line + offset}: ${message}`);
  if (section.name === '') {
    fail(0, 'a scout needs a name after "## "');
  }
  let id: string | null = null;
  let repos: string[] | null = null;
  const paths: ScoutPathHint[] = [];
  let bodyStart = section.lines.length;
  for (const [index, raw] of section.lines.entries()) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (!key) {
      bodyStart = index;
      break;
    }
    const name = key[1]!.toLowerCase();
    const value = key[2]!.trim();
    if (name === 'id') {
      id = value;
      if (!ID.test(value)) {
        fail(index + 1, `id "${value}" must be lower-case letters, digits and single dashes`);
      }
    } else if (name === 'repos') {
      repos = [...new Set(listItems(value, true))];
      for (const repo of repos.filter((item) => !REPO.test(item))) {
        fail(index + 1, `repo "${repo}" is not owner/name`);
      }
    } else {
      for (const entry of listItems(value, false)) {
        const hint = parsePathHint(entry);
        if (typeof hint === 'string') {
          fail(index + 1, hint);
        } else {
          paths.push(hint);
        }
      }
    }
  }
  if (repos === null || repos.length === 0) {
    fail(0, `"${section.name}" needs a repos: line (owner/name, comma-separated)`);
  }
  const prompt = section.lines.slice(bodyStart).join('\n').trim();
  if (prompt === '') {
    fail(0, `"${section.name}" needs a prompt: text after its key lines saying what to pull in`);
  }
  const finalId = id ?? scoutSlug(section.name);
  if (finalId === '') {
    fail(0, `"${section.name}" has no letters or digits for an id; add an id: line`);
  }
  if (errors.length > before) {
    return null;
  }
  return { id: finalId, name: section.name, repos: repos ?? [], paths, prompt };
}

/**
 * Every scout in the file, in file order. Duplicate ids are an error: a
 * rename without an `id:` line is a new scout (fresh cursors and history),
 * so two headings that slug alike would share one history otherwise.
 */
export function parseScouts(text: string): ScoutsParse {
  const errors: string[] = [];
  const scouts: ScoutConfig[] = [];
  const lineOfId = new Map<string, number>();
  for (const section of sectionsOf(text)) {
    const scout = parseSection(section, errors);
    if (scout === null) {
      continue;
    }
    const earlier = lineOfId.get(scout.id);
    if (earlier !== undefined) {
      errors.push(`line ${section.line}: id "${scout.id}" is already used by the scout on line ${earlier}; give one of them an id: line`);
      continue;
    }
    lineOfId.set(scout.id, section.line);
    scouts.push(scout);
  }
  return { scouts, errors };
}
