import { applyLegacyEnv } from '@postpile/engine';
import { runMcpFromEnv } from '@postpile/mcp';
import { readOwnVersion } from '@postpile/server';

applyLegacyEnv();

runMcpFromEnv(readOwnVersion()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
