// The read-only MCP server, bundled next to the main process as out/main/mcp.js.
// It never starts Electron: Contents/Resources/postpile-mcp runs the app's own
// binary with ELECTRON_RUN_AS_NODE=1 on this file, so users need no Node
// install and get the same engine and database code as the app.
import { applyLegacyEnv } from '@postpile/engine';
import { runMcpFromEnv } from '@postpile/mcp';
import { appVersion } from './app-version.ts';

applyLegacyEnv();

runMcpFromEnv(appVersion(import.meta.dirname)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
