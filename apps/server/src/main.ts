// Standalone server for development and the future web app:
//   npm start -w @code-manager/server
//   CODE_MANAGER_FAKE=1 npm start -w @code-manager/server   (sample data)
import { engineFromEnv } from './engine-from-env.ts';
import { startServer } from './start.ts';

const port = Number(process.env.PORT || 4870);
const engine = engineFromEnv();
const server = await startServer({ engine, port, token: process.env.CODE_MANAGER_TOKEN || null });
console.log(`code-manager API on ${server.url}`);

async function shutdown(): Promise<void> {
  await engine.flushPendingWrites().catch((error: unknown) => console.error(error));
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
