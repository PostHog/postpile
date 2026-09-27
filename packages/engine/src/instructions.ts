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
