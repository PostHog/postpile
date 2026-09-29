// Standalone server for development and the future web app:
//   pnpm --filter @postpile/server start
//   POSTPILE_FAKE=1 pnpm --filter @postpile/server start   (sample data)
//   GitHub writes are off until the footer lock is opened; POSTPILE_READ_ONLY=1 keeps them off
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { applyLegacyEnv, type EngineService } from '@postpile/engine';
import { appConfigFromEnv, engineFromEnv, updateSourceFromEnv } from './engine-from-env.ts';
import { startServer } from './start.ts';

applyLegacyEnv();

const port = Number(process.env.PORT || 4870);
// A fresh token per run unless one is given, so web pages cannot drive the API.
const token = process.env.POSTPILE_TOKEN || randomBytes(24).toString('hex');
let engine: EngineService;
try {
  engine = engineFromEnv({ lockKind: 'server' });
} catch (error) {
  // DataDirLockedError: another PostPile process has this database.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
// Every package carries the desktop version (package-versions.test.ts), so the server's own is the app's.
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const server = await startServer({ engine, port, token, config: appConfigFromEnv(), updates: updateSourceFromEnv(version) });
console.log(`PostPile API on ${server.url}`);
console.log(`token: ${token}  (send it as x-postpile-token, or open the UI with ?token=${token})`);

async function shutdown(): Promise<void> {
  await engine.flushPendingWrites().catch((error: unknown) => console.error(error));
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
