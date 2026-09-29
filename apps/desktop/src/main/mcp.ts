// The read-only MCP server, bundled next to the main process as out/main/mcp.js.
// It never starts Electron: Contents/Resources/postpile-mcp runs the app's own
// binary with ELECTRON_RUN_AS_NODE=1 on this file, so users need no Node
// install and get the same engine and database code as the app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyLegacyEnv } from '@postpile/engine';
import { runMcpFromEnv } from '@postpile/mcp';

/** out/main/mcp.js -> the app's package.json (inside app.asar when packaged). */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

applyLegacyEnv();

runMcpFromEnv(appVersion()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
