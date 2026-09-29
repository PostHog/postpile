import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The telemetry identity before the viewer's GitHub id is known (first run,
 * setup): a random id kept in the data folder, read back on every later
 * start. `setViewerIdentity` aliases it to the hashed GitHub id once the
 * viewer is fetched, so the two identities merge into one PostHog person.
 */
export function loadOrCreateInstallId(file: string | undefined): string {
  if (!file) {
    // No telemetryIdFile (tests, read-only access without a data folder): a fresh id for this process only.
    return randomUUID();
  }
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Missing or unreadable: fall through and create one.
  }
  const id = randomUUID();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, id, 'utf8');
  return id;
}
