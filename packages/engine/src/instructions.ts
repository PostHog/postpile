import { readFileSync } from 'node:fs';

/** The user's general instructions. A missing file means none, not an error. */
export function readInstructions(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

const unreviewedMergePhrases = [/merged without (my )?review/i, /without my review/i, /unreviewed merge/i];

/**
 * "Merged without your review" is only loud when the user said they care.
 * A plain phrase match keeps this predictable; the agent can still override
 * single events later.
 */
export function caresAboutUnreviewedMerges(...texts: string[]): boolean {
  return texts.some((text) => unreviewedMergePhrases.some((phrase) => phrase.test(text)));
}
