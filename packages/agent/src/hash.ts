import { createHash } from 'node:crypto';

/**
 * Stable hash of everything that went into a prompt. Glances, topic summaries
 * and sets store it and are regenerated only when it changes. Bump
 * PROMPT_VERSION when prompt wording changes in a way that should invalidate
 * cached answers.
 */
export const PROMPT_VERSION = 'v2';

export function inputHash(...parts: unknown[]): string {
  const hash = createHash('sha256');
  hash.update(PROMPT_VERSION);
  for (const part of parts) {
    hash.update('\u0000');
    hash.update(typeof part === 'string' ? part : JSON.stringify(part));
  }
  return hash.digest('hex');
}
