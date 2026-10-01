// Standalone server: the API, the background jobs and, when it finds a built
// UI (apps/desktop/dist-web, or web/ next to the bundle), the web page itself.
//   pnpm --filter @postpile/server start
//   POSTPILE_FAKE=1 pnpm --filter @postpile/server start   (sample data)
//   GitHub writes are off until the footer lock is opened; POSTPILE_READ_ONLY=1 keeps them off
import { homedir, arch, release } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppInstall, McpLauncher } from '@postpile/core';
import { applyLegacyEnv, defaultPaths, launchToolPath, telemetryFromEnv, type EngineService } from '@postpile/engine';
import { appConfigFromEnv, engineFromEnv, isFake, updateSourceFromEnv, readOwnVersion } from './engine-from-env.ts';
import { startBackgroundJobs } from './background-jobs.ts';
import { SERVER_TOKEN_FILE_NAME, serverToken } from './server-token.ts';
import { startServer } from './start.ts';
import { findWebRoot } from './web-ui.ts';

applyLegacyEnv();
process.env.PATH = launchToolPath({ envPath: process.env.PATH ?? '', home: homedir(), configFile: defaultPaths().configFile ?? '' });

const install: AppInstall = process.env.POSTPILE_INSTALL === 'brew-service' ? 'brew-service' : 'source';
const mcpLauncher: McpLauncher | null = process.env.POSTPILE_MCP_LAUNCHER ? { kind: 'app', path: process.env.POSTPILE_MCP_LAUNCHER } : null;
const port = Number(process.env.PORT || 4870);
const token = serverToken(process.env, isFake() ? null : join(dirname(defaultPaths().databaseFile), SERVER_TOKEN_FILE_NAME));
const webRoot = findWebRoot(process.env, import.meta.dirname);
const config = appConfigFromEnv(install);
const appVersion = readOwnVersion();
const telemetry = telemetryFromEnv({
  env: process.env,
  appVersion,
  osVersion: release(),
  arch: arch(),
  telemetryIdFile: config.fake ? undefined : defaultPaths().telemetryIdFile,
});
process.on('uncaughtException', (error) => telemetry.captureException(error));
process.on('unhandledRejection', (reason) => telemetry.captureException(reason));

let engine: EngineService;
try {
  engine = engineFromEnv({ lockKind: 'server', telemetry, appVersion, mcpLauncher });
} catch (error) {
  // DataDirLockedError: another PostPile process has this database.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const server = await startServer({ engine, port, token, config, updates: updateSourceFromEnv(appVersion), telemetry, webRoot });
console.log(`PostPile ${appVersion} API on ${server.url}, profile ${config.profile}, PATH ${process.env.PATH}`);
if (webRoot) {
  console.log(`web UI: ${server.url}/ (from ${webRoot})`);
} else {
  console.log(`token: ${token}  (send it as x-postpile-token, or open the UI with ?token=${token}); no built web UI found, run pnpm build:web`);
}
const backgroundJobs = startBackgroundJobs(engine, config);

async function shutdown(): Promise<void> {
  backgroundJobs.stop();
  await engine.flushPendingWrites().catch((error: unknown) => console.error(error));
  await server.close();
  // Flushes telemetry (the fake engine holds none of its own).
  await engine.close().catch((error: unknown) => console.error(error));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
