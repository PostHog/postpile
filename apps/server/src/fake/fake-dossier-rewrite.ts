import { dossierStatusText, type Dossier, type FixedClaim } from '@postpile/core';

/** What the user said about a dossier's lines since its latest version. */
export interface DossierCorrections {
  /** Line texts marked wrong or forgotten. */
  dropped: string[];
  fixes: FixedClaim[];
}

/** The line as it reads after the corrections: null when it goes, the fixed text, or unchanged. */
function correctedText(text: string, corrections: DossierCorrections): string | null {
  if (corrections.dropped.includes(text)) {
    return null;
  }
  return corrections.fixes.find((fix) => fix.text === text)?.fixed ?? text;
}

/** Corrects each item of a list by its line text; dropped items go. */
function correctList<T>(items: T[], textOf: (item: T) => string, withText: (item: T, text: string) => T, corrections: DossierCorrections): T[] {
  return items.flatMap((item) => {
    const text = correctedText(textOf(item), corrections);
    return text === null ? [] : [withText(item, text)];
  });
}

/** "status: note" as the user saw it; a fix may keep or drop the "status: " part. */
function correctedStatusNote(dossier: Dossier, corrections: DossierCorrections): string {
  const seen = dossierStatusText(dossier);
  const text = correctedText(seen, corrections);
  if (text === null) {
    return '';
  }
  if (text === seen) {
    return dossier.statusNote;
  }
  const prefix = `${dossier.status}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * The fake's stand-in for a dossier update that read the user's corrections:
 * lines marked wrong or forgotten are gone, fixed lines carry the corrected
 * text. Lines are matched by the text the user saw, like the notes the
 * engine logs (`fixedClaimNote`).
 */
export function correctedDossier(dossier: Dossier, corrections: DossierCorrections): Dossier {
  return {
    ...dossier,
    goal: correctedText(dossier.goal, corrections) ?? '',
    statusNote: correctedStatusNote(dossier, corrections),
    openQuestions: correctList(dossier.openQuestions, (question) => question.text, (question, text) => ({ ...question, text }), corrections),
    timeline: correctList(
      dossier.timeline,
      (entry) => `${entry.prKey}: ${entry.role}`,
      (entry, text) => ({ ...entry, role: text.startsWith(`${entry.prKey}: `) ? text.slice(entry.prKey.length + 2) : text }),
      corrections,
    ),
    userCares: correctList(dossier.userCares, (care) => care.text, (care, text) => ({ ...care, text }), corrections),
    recentChanges: correctList(dossier.recentChanges, (change) => change.text, (change, text) => ({ ...change, text }), corrections),
  };
}
