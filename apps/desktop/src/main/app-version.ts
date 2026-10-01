import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** out/main (the entry's folder, passed in: shared modules land in out/main/chunks) -> the app's package.json, inside app.asar when packaged. */
export function appVersion(entryDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(entryDir, '../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
