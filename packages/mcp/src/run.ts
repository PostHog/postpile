import { arch, release } from 'node:os';
import { dirname, join } from 'node:path';
import { AGENT_REQUESTS_FOLDER } from '@postpile/core';
import { LATEST_SCHEMA_VERSION, defaultPaths, lockedAppVersion, runningApp, telemetryFromEnv } from '@postpile/engine';
import { engineFromEnv, isFake } from '@postpile/server';
import { FileAgentRequests, InMemoryAgentRequests, type AgentRequests } from './agent-requests.ts';
import { routeConsoleToStderr, serveStdio } from './server.ts';
import { updateCheck } from './update-check.ts';

/** How long a "running" answer counts: it runs ps, and a busy agent may call several tools a second. */
const APP_CHECK_MS = 5000;

/**
 * Whether the desktop app holds the database folder. Only a "running" answer
 * is kept (for APP_CHECK_MS); "closed" is looked up again on every call, so
 * the first call after the app opens works.
 */
function appRunningCheck(databaseFile: string): () => boolean {
  let runningUntil = 0;
  return () => {
    const now = Date.now();
    if (now < runningUntil) {
      return true;
    }
    const running = runningApp(databaseFile) !== null;
    if (running) {
      runningUntil = now + APP_CHECK_MS;
    }
    return running;
  };
}

/**
 * The whole MCP process, for `pnpm cli mcp` and the app bundle's
 * postpile-mcp. Opens the database read-only without the lock (no
 * migrations, safe next to the running app) and serves until the client hangs
 * up. Every tool refuses while the app is closed; the process stays up and
 * answers again once it opens. After an app update (another schema or app
 * version) every tool refuses until the session reconnects. POSTPILE_FAKE=1 serves the sample data.
 */
export async function runMcpFromEnv(appVersion: string): Promise<void> {
  routeConsoleToStderr();
  const telemetry = isFake()
    ? undefined
    : telemetryFromEnv({ env: process.env, appVersion, osVersion: release(), arch: arch(), telemetryIdFile: defaultPaths().telemetryIdFile });
  const engine = engineFromEnv({ lockKind: 'cli', withoutLock: true, telemetry, appVersion });
  const databaseFile = defaultPaths().databaseFile;
  // Sample data has no app to ask: it counts as running, and the fake engine answers requests in memory.
  // Same database as above, so the dev profile and POSTPILE_DB pick the app that owns it.
  const appRunning = isFake() ? () => true : appRunningCheck(databaseFile);
  const requests: AgentRequests = isFake()
    ? new InMemoryAgentRequests(engine)
    : // A fresh look at the lock before every request, not the cached one.
      new FileAgentRequests({ folder: join(dirname(databaseFile), AGENT_REQUESTS_FOLDER), appRunning: () => runningApp(databaseFile) !== null });
  try {
    await serveStdio(engine, {
      version: appVersion,
      appRunning,
      // Sample data has no database or app to go stale.
      updated: isFake()
        ? undefined
        : updateCheck({
            ownVersion: appVersion,
            expectedSchema: LATEST_SCHEMA_VERSION,
            databaseSchema: () => engine.databaseSchemaVersion(),
            appVersion: () => lockedAppVersion(databaseFile),
          }),
      requests,
      onToolCall: (tool, report) =>
        telemetry?.capture('mcp_tool_called', { tool, found: report.found, response_chars: report.responseChars, error: report.error }),
    });
  } finally {
    // Also flushes the telemetry.
    await engine.close();
  }
}
