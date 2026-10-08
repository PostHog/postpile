import type { ClaimBasis, ForWhom, Glance, Verdict } from '@postpile/core';
import { forWhomLabel } from './why.ts';

/** "!" main point, "?" what to check, "▲" a risk. */
export type AssessmentMark = '!' | '?' | '▲';

export interface AssessmentLine {
  mark: AssessmentMark;
  text: string;
}

export interface Assessment {
  verdict: Verdict;
  /** "LOOK CLOSER". */
  title: string;
  /** "· for you", "· for team-devex", "· your PR"; empty when for nobody in particular or not yours. */
  tag: string;
  /** "· not checked: inferred from the description" for the verdict's reason; empty when checked or not recorded. */
  unchecked: string;
  lines: AssessmentLine[];
  /** Null when there is no risk content at all, or the level is low (the verdict box covers it). */
  risk: { level: string; unchecked: string; lines: AssessmentLine[] } | null;
  does: string;
  others: string;
}

/** At most this many marked lines per box. */
const LINES_PER_BOX = 3;

const TITLES: Record<Verdict, string> = { LOOK_CLOSER: 'LOOK CLOSER', LOOKS_SAFE: 'LOOKS SAFE', NOT_YOURS: 'NOT YOURS' };

const CHECK_WORDS = /\?|\b(check|verify|make sure|confirm|look at|ask|see whether|see if|test)\b/i;

/**
 * Splits prose into short lines: one per sentence, trimmed, empty ones
 * dropped. Dots inside numbers, versions and file names ("v2.5", "ci.yml")
 * do not end a sentence; only a dot, ! or ? followed by a space does.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(#@`])/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** "medium - what could break" -> level "medium", rest "what could break". */
export function splitRisk(risk: string): { level: string; rest: string } {
  const match = /^\s*(low|medium|high)\b\s*[-–—:.,]?\s*(.*)$/is.exec(risk);
  if (!match) {
    return { level: '', rest: risk.trim() };
  }
  return { level: match[1]!.toLowerCase(), rest: match[2]!.trim() };
}

function tagFor(verdict: Verdict, forWhom: ForWhom | null): string {
  if (verdict === 'NOT_YOURS' || !forWhom || forWhom.kind === 'none') {
    return '';
  }
  return `· ${forWhomLabel(forWhom).replace(/^For /, 'for ').replace(/^Your PR$/, 'your PR')}`;
}

/**
 * The muted note for a claim the agent says it did not check. A checked
 * claim shows nothing: the box is calm by default, and the MCP answers
 * carry both sides (DESIGN.md "Glance claim basis"). Same words as core's
 * claimBasisText; the renderer imports no runtime code from core.
 */
function uncheckedNote(basis: ClaimBasis | null | undefined): string {
  if (!basis || basis.checked) {
    return '';
  }
  return basis.note ? `· not checked: ${basis.note}` : '· not checked';
}

/** The for-you lines: the first sentence is the main point, later ones that ask for a check get "?". */
function youLines(forYou: string): AssessmentLine[] {
  return sentences(forYou)
    .slice(0, LINES_PER_BOX)
    .map((text, index) => ({ mark: index > 0 && CHECK_WORDS.test(text) ? '?' : '!', text }));
}

/** The agent's own risk sentences. CI is never added here: checks only show in the facts (2026-09-29). */
function riskLines(rest: string): AssessmentLine[] {
  return sentences(rest)
    .slice(0, LINES_PER_BOX)
    .map((text) => ({ mark: '▲', text }));
}

/**
 * The detail pane's assessment from a glance ("verdict as the box title"):
 * box 1 titled with the verdict holds the for-you lines, box 2 "RISK · level"
 * the agent's risk lines, then plain Does and Others lines. The
 * verdict and the risk level each appear once. A low risk gets no box: a red
 * box around "Low. CI green." reads as an alarm, and the verdict already
 * says it looks fine; medium, high and an unlabeled risk keep it.
 */
export function assessment(glance: Glance, forWhom: ForWhom | null): Assessment {
  const risk = splitRisk(glance.risk);
  const lines = riskLines(risk.rest);
  const hasRisk = risk.level !== 'low' && (risk.level !== '' || lines.length > 0);
  return {
    verdict: glance.verdict,
    title: TITLES[glance.verdict],
    tag: tagFor(glance.verdict, forWhom),
    unchecked: uncheckedNote(glance.basis?.verdict),
    lines: youLines(glance.forYou),
    risk: hasRisk ? { level: risk.level, unchecked: uncheckedNote(glance.basis?.risk), lines } : null,
    does: glance.does.trim(),
    others: glance.othersSaid.trim(),
  };
}
