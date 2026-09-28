// Standalone server for development and the future web app:
//   npm start -w @postpile/server
//   CODE_MANAGER_FAKE=1 npm start -w @postpile/server   (sample data)
//   GitHub writes are off until the footer lock is opened; CODE_MANAGER_READ_ONLY=1 keeps them off
import { randomBytes } from 'node:crypto';
import { appConfigFromEnv, engineFromEnv } from './engine-from-env.ts';
import { startServer } from './start.ts';

const port = Number(process.env.PORT || 4870);
// A fresh token per run unless one is given, so web pages cannot drive the API.
const token = process.env.CODE_MANAGER_TOKEN || randomBytes(24).toString('hex');
const engine = engineFromEnv();
const server = await startServer({ engine, port, token, config: appConfigFromEnv() });
console.log(`code-manager API on ${server.url}`);
console.log(`token: ${token}  (send it as x-code-manager-token, or open the UI with ?token=${token})`);

async function shutdown(): Promise<void> {
  await engine.flushPendingWrites().catch((error: unknown) => console.error(error));
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
