import type { Dossier, DossierVersion } from './memory.ts';
import type { DossierVersionNote } from './memory-views.ts';

/** Versions listed under "Version history" in the topic view. */
export const DOSSIER_HISTORY_SHOWN = 5;

function added(before: string[], after: string[]): string[] {
  return after.filter((item) => !before.includes(item));
}

function removed(before: string[], after: string[]): string[] {
  return before.filter((item) => !after.includes(item));
}

/** Short, deterministic lines on what changed between two dossiers. No agent involved. */
export function dossierChanges(before: Dossier, after: Dossier): string[] {
  const lines: string[] = [];
  if (before.status !== after.status) {
    lines.push(`Status: ${before.status} → ${after.status}`);
  }
  if (before.goal !== after.goal) {
    lines.push('Goal rewritten');
  }
  const peopleBefore = before.people.map((person) => `@${person.login} (${person.role})`);
  const peopleAfter = after.people.map((person) => `@${person.login} (${person.role})`);
  for (const person of added(peopleBefore, peopleAfter)) {
    lines.push(`Person added: ${person}`);
  }
  for (const person of removed(peopleBefore, peopleAfter)) {
    lines.push(`Person dropped: ${person}`);
  }
  const questionsBefore = before.openQuestions.map((question) => question.text);
  const questionsAfter = after.openQuestions.map((question) => question.text);
  for (const question of added(questionsBefore, questionsAfter)) {
    lines.push(`New question: ${question}`);
  }
  for (const question of removed(questionsBefore, questionsAfter)) {
    lines.push(`Question closed: ${question}`);
  }
  const prsBefore = before.timeline.map((entry) => entry.prKey);
  const prsAfter = after.timeline.map((entry) => entry.prKey);
  for (const prKey of added(prsBefore, prsAfter)) {
    lines.push(`PR joined: ${prKey}`);
  }
  for (const prKey of removed(prsBefore, prsAfter)) {
    lines.push(`PR left: ${prKey}`);
  }
  const caresBefore = before.userCares.map((care) => care.text);
  const caresAfter = after.userCares.map((care) => care.text);
  for (const care of added(caresBefore, caresAfter)) {
    lines.push(`Now cares: ${care}`);
  }
  for (const care of removed(caresBefore, caresAfter)) {
    lines.push(`No longer cares: ${care}`);
  }
  return lines;
}

/**
 * Version notes, newest first, for versions given newest first. The oldest
 * version passed in has nothing to compare against, so pass one more than
 * you show when older versions exist.
 */
export function dossierVersionNotes(versions: DossierVersion[], shown: number = DOSSIER_HISTORY_SHOWN): DossierVersionNote[] {
  const notes: DossierVersionNote[] = [];
  for (let index = 0; index < Math.min(versions.length, shown); index += 1) {
    const current = versions[index]!;
    const previous = versions[index + 1];
    notes.push({
      version: current.version,
      createdAt: current.createdAt,
      changes: previous ? dossierChanges(previous.dossier, current.dossier) : [],
    });
  }
  return notes;
}
