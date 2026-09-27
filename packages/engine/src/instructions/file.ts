import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

/**
 * Writes the whole text through a temp file and a rename, so a crash never
 * leaves half a file. A symlinked file (dotfiles) is written at its target:
 * renaming over the link itself would replace it with a plain file.
 */
export function writeInstructionsAtomically(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  writeFileSync(temp, text, 'utf8');
  renameSync(temp, target);
}
