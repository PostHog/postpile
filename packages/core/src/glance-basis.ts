import type { ClaimBasis } from './types.ts';

/** A note longer than this is cut: it is a few words, not a second risk line. */
const NOTE_MAX = 80;

function cleanNote(text: string): string {
  const note = text.trim().replace(/\s+/g, ' ');
  return note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1).trimEnd()}…` : note;
}

/**
 * Reads the agent's "checked: <against what>" or "not checked: <why>"
 * (DESIGN.md "Glance claim basis"). "unchecked" counts as not checked.
 * A bare "checked" names no evidence, so it is null like anything else
 * unreadable: only "checked: <against what>" earns the word (Codex review
 * on #158). A garbled basis shows nothing rather than a wrong "checked".
 */
export function parseClaimBasis(value: unknown): ClaimBasis | null {
  if (typeof value !== 'string') {
    return null;
  }
  const notChecked = /^\s*(?:not\s+checked|unchecked)\b[\s:,.\-–—]*(.*)$/is.exec(value);
  if (notChecked) {
    return { checked: false, note: cleanNote(notChecked[1]!) };
  }
  const checked = /^\s*checked\b[\s:,.\-–—]*(.*)$/is.exec(value);
  const evidence = checked ? cleanNote(checked[1]!) : '';
  if (evidence) {
    return { checked: true, note: evidence };
  }
  return null;
}

/** "checked: changed files", "not checked: inferred from the description", or just the word without a note. */
export function claimBasisText(basis: ClaimBasis): string {
  const word = basis.checked ? 'checked' : 'not checked';
  return basis.note ? `${word}: ${basis.note}` : word;
}
