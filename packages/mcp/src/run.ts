import { arch, release } from 'node:os';
import { defaultPaths, telemetryFromEnv } from '@postpile/engine';
import { engineFromEnv, isFake } from '@postpile/server';
import { routeConsoleToStderr, serveStdio } from './server.ts';

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
  try {
    await serveStdio(engine, {
      version: appVersion,
      onToolCall: (tool, found) => telemetry?.capture('mcp_tool_called', { tool, found }),
    });
  } finally {
    // Also flushes the telemetry.
    await engine.close();
  }
}
