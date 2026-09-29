import { arch, release } from 'node:os';
import { defaultPaths, runningApp, telemetryFromEnv } from '@postpile/engine';
import { engineFromEnv, isFake } from '@postpile/server';
import { routeConsoleToStderr, serveStdio } from './server.ts';

/** How long one look at postpile.lock counts: it runs ps, and a busy agent may call several tools a second. */
const APP_CHECK_MS = 5000;

/** Whether the desktop app holds the database folder, asked at most every APP_CHECK_MS. */
function appRunningCheck(databaseFile: string): () => boolean {
  let checkedAt = 0;
  let running = false;
  return () => {
    const now = Date.now();
    if (now - checkedAt >= APP_CHECK_MS) {
      checkedAt = now;
      running = runningApp(databaseFile) !== null;
    }
    return running;
  };
}

/**
 * The whole MCP process, for `pnpm cli mcp` and the app bundle's
 * postpile-mcp. Opens the database read-only without the lock (no
 * migrations, safe next to the running app, works with the app closed) and
 * serves until the client hangs up. POSTPILE_FAKE=1 serves the sample data.
 */
export async function runMcpFromEnv(appVersion: string): Promise<void> {
  routeConsoleToStderr();
  const telemetry = isFake()
    ? undefined
    : telemetryFromEnv({ env: process.env, appVersion, osVersion: release(), arch: arch(), telemetryIdFile: defaultPaths().telemetryIdFile });
  const engine = engineFromEnv({ lockKind: 'cli', withoutLock: true, telemetry });
  // Sample data has no app to ask: it counts as running.
  const appRunning = isFake() ? () => true : appRunningCheck(defaultPaths().databaseFile);
  try {
    await serveStdio(engine, {
      version: appVersion,
      appRunning,
      onToolCall: (tool, report) =>
        telemetry?.capture('mcp_tool_called', { tool, found: report.found, response_chars: report.responseChars, error: report.error }),
    });
  } finally {
    // Also flushes the telemetry.
    await engine.close();
  }
}
