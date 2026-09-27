// Rules that read the user's own instructions text. Reading the file is IO
// and lives in the engine; this only looks at the text.

const unreviewedMergePhrases = [/merged without (my )?review/i, /without my review/i, /unreviewed merge/i];

/**
 * "Merged without your review" is only loud when the user said they care.
 * A plain phrase match keeps this predictable; the agent can still override
 * single events later.
 */
export function caresAboutUnreviewedMerges(...texts: string[]): boolean {
  return texts.some((text) => unreviewedMergePhrases.some((phrase) => phrase.test(text)));
}
