import type { LessonSource } from './lessons.ts';

/**
 * A topic's tailoring ("Kept for this topic") is plain text, one entry per
 * line: what the user kept from chat, accepted topic rules and lessons kept
 * in the topic. Every prompt for the topic reads it as is.
 */

/** The tailoring's entries, in order, blank lines left out. */
export function tailoringLines(tailoring: string): string[] {
  return tailoring
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The tailoring with one more entry at the end. */
export function appendTailoring(tailoring: string, line: string): string {
  return [...tailoringLines(tailoring), line.trim()].filter((entry) => entry !== '').join('\n');
}

/** The tailoring without its first entry equal to `line`, or null when it has no such entry. */
export function removeTailoringLine(tailoring: string, line: string): string | null {
  const lines = tailoringLines(tailoring);
  const index = lines.indexOf(line.trim());
  if (index === -1) {
    return null;
  }
  return lines.filter((_, at) => at !== index).join('\n');
}

/**
 * A merged topic's entries as they join the target's tailoring: each one
 * says where it came from ("From Frontend build: Only cache changes."), so
 * the target's readers know it was said about other work. Entries the
 * target already holds are left out.
 */
export function mergedTailoringLines(intoTailoring: string, fromTailoring: string, fromName: string): string[] {
  const existing = new Set(tailoringLines(intoTailoring));
  return tailoringLines(fromTailoring)
    .map((line) => `From ${fromName}: ${line}`)
    .filter((line) => !existing.has(line));
}

/** A lesson kept in its topic, as its tailoring entry: says it came from the user's review or note, not their own words to the agent. */
export function lessonTailoringLine(source: LessonSource, prNumber: number, text: string): string {
  const from = source === 'review' ? 'your review' : 'your note';
  return prNumber > 0 ? `From ${from} on #${prNumber}: ${text.trim()}` : `From ${from}: ${text.trim()}`;
}
