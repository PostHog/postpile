// The setup fit check: the agent's notes on lines PostPile cannot act on,
// lines under the wrong heading and lines too vague to apply, mapped back
// onto the text the user has. DESIGN.md "Setup flow".

import { clipText } from './dossier.ts';
import { claimKey, SETUP_HEADINGS } from './setup-draft.ts';
import type { SetupFitKind, SetupFitNote, SetupSectionEdit } from './setup.ts';

/** Bounds on the answer: a handful of notes is useful, a wall of them is noise. */
export const SETUP_FIT_LIMITS = {
  notes: 12,
  whyChars: 240,
  rewriteChars: 300,
};

const FIT_KINDS: SetupFitKind[] = ['no_effect', 'wrong_section', 'unclear'];

/** The agent's answer after zod, before any line or heading is checked. */
export interface SetupFitAnswer {
  notes: { heading: string; line: string; kind: string; why: string; moveTo: string | null; rewrite: string | null }[];
}

interface FoundLine {
  heading: string;
  line: string;
}

/** A line's bullet and spaces dropped, as the user sees it. */
function lineText(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .trim();
}

/**
 * Where a line the agent quoted is in the user's text: under the heading it
 * named when it is there, else under any heading. Null when the text has no
 * such line (the agent misquoted it, or the user changed it meanwhile).
 */
function findLine(sections: SetupSectionEdit[], heading: string, line: string): FoundLine | null {
  const wanted = claimKey(line);
  if (wanted === '') {
    return null;
  }
  const named = sections.filter((section) => section.heading.toLowerCase() === heading.trim().toLowerCase());
  const others = sections.filter((section) => !named.includes(section));
  for (const section of [...named, ...others]) {
    const match = section.body.split('\n').find((candidate) => claimKey(candidate) === wanted);
    if (match !== undefined) {
      return { heading: section.heading, line: lineText(match) };
    }
  }
  return null;
}

/** The heading a move names, spelled as the text or the usual headings spell it; null when it names none. */
function knownHeading(sections: SetupSectionEdit[], name: string | null): string | null {
  const wanted = (name ?? '').replace(/^#+\s*/, '').trim().toLowerCase();
  const headings = [...sections.map((section) => section.heading), ...SETUP_HEADINGS];
  return headings.find((heading) => heading.toLowerCase() === wanted) ?? null;
}

/**
 * The answer onto the user's text. A note stays only when its line is in the
 * text, its kind is known, and a move names another known heading. The line
 * and heading come from the text, never from the answer. One note per line,
 * at most SETUP_FIT_LIMITS.notes.
 */
export function mapSetupFit(answer: SetupFitAnswer, sections: SetupSectionEdit[]): SetupFitNote[] {
  const notes: SetupFitNote[] = [];
  const seen = new Set<string>();
  for (const raw of answer.notes) {
    const kind = FIT_KINDS.find((entry) => entry === raw.kind);
    const found = findLine(sections, raw.heading, raw.line);
    if (!kind || !found || seen.has(claimKey(found.line))) {
      continue;
    }
    const moveTo = kind === 'wrong_section' ? knownHeading(sections, raw.moveTo) : null;
    if (kind === 'wrong_section' && (moveTo === null || moveTo === found.heading)) {
      continue;
    }
    const rewrite = clipText(lineText(raw.rewrite ?? ''), SETUP_FIT_LIMITS.rewriteChars);
    notes.push({
      heading: found.heading,
      line: found.line,
      kind,
      why: clipText(raw.why, SETUP_FIT_LIMITS.whyChars),
      moveTo,
      rewrite: rewrite === '' || claimKey(rewrite) === claimKey(found.line) ? null : rewrite,
    });
    seen.add(claimKey(found.line));
    if (notes.length >= SETUP_FIT_LIMITS.notes) {
      break;
    }
  }
  return notes;
}
