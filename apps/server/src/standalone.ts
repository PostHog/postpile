import { homedir, arch, release } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppInstall, McpLauncher } from '@postpile/core';
import { applyLegacyEnv, DataDirLockedError, defaultPaths, launchToolPath, telemetryFromEnv, type EngineService, type Telemetry } from '@postpile/engine';
import { appConfigFromEnv, engineFromEnv, isFake, updateSourceFromEnv } from './engine-from-env.ts';
import { startBackgroundJobs } from './background-jobs.ts';
import { PingFeed } from './ping-feed.ts';
import { SERVER_TOKEN_FILE_NAME, serverToken } from './server-token.ts';
import { startServer } from './start.ts';

export const DEFAULT_PORT = 4870;
export const LOCK_RETRY_MS = 30_000;

export interface StandaloneOptions {
  appVersion: string;
  install: AppInstall;
  webRoot: string | null;
  mcpLauncher: McpLauncher | null;
  waitForLock: boolean;
}

async function openEngine(options: StandaloneOptions, telemetry: Telemetry): Promise<EngineService> {
  let waitingLogged = false;
  for (;;) {
    try {
      return engineFromEnv({ lockKind: 'server', telemetry, appVersion: options.appVersion, mcpLauncher: options.mcpLauncher });
    } catch (error) {
      if (!(error instanceof DataDirLockedError) || !options.waitForLock) {
        throw error;
      }
      if (!waitingLogged) {
        waitingLogged = true;
        console.log(`${error.message}\nWaiting until it closes; checking every ${LOCK_RETRY_MS / 1000}s.`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

export async function runStandaloneServer(options: StandaloneOptions): Promise<void> {
  applyLegacyEnv();
  process.env.PATH = launchToolPath({ envPath: process.env.PATH ?? '', home: homedir(), configFile: defaultPaths().configFile ?? '' });
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const token = serverToken(process.env, isFake() ? null : join(dirname(defaultPaths().databaseFile), SERVER_TOKEN_FILE_NAME));
  const config = appConfigFromEnv(options.install);
  const telemetry = telemetryFromEnv({
    env: process.env,
    appVersion: options.appVersion,
    osVersion: release(),
    arch: arch(),
    telemetryIdFile: config.fake ? undefined : defaultPaths().telemetryIdFile,
  });
  process.on('uncaughtException', (error) => telemetry.captureException(error));
  process.on('unhandledRejection', (reason) => telemetry.captureException(reason));

  let engine: EngineService;
  try {
    engine = await openEngine(options, telemetry);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const pings = new PingFeed();
  const server = await startServer({ engine, port, token, config, updates: updateSourceFromEnv(options.appVersion), telemetry, webRoot: options.webRoot, pings });
  console.log(`PostPile ${options.appVersion} API on ${server.url}, profile ${config.profile}, PATH ${process.env.PATH}`);
  if (options.webRoot) {
    console.log(`PostPile in the browser: http://postpile.localhost:${server.port}/ (or ${server.url}/)`);
  } else {
    console.log(`token: ${token}  (send it as x-postpile-token, or open the UI with ?token=${token}); no built web UI found, run pnpm build:web`);
  }
  const backgroundJobs = startBackgroundJobs(engine, config, { onNotify: (notifications) => pings.push(notifications) });

  async function shutdown(): Promise<void> {
    backgroundJobs.stop();
    await engine.flushPendingWrites().catch((error: unknown) => console.error(error));
    await server.close();
    await engine.close().catch((error: unknown) => console.error(error));
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
