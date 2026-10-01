// Standalone server from source: the API, the background jobs and, once
// `pnpm build:web` has run, the web UI itself. The packaged app runs the same
// server as `postpile browser` (apps/desktop/src/main/browser.ts).
//   pnpm --filter @postpile/server start
//   POSTPILE_FAKE=1 pnpm --filter @postpile/server start   (sample data)
//   GitHub writes are off until the footer lock is opened; POSTPILE_READ_ONLY=1 keeps them off
import { join } from 'node:path';
import { readOwnVersion } from './engine-from-env.ts';
import { runStandaloneServer } from './standalone.ts';
import { findWebRoot } from './web-ui.ts';

await runStandaloneServer({
  appVersion: readOwnVersion(),
  install: 'source',
  webRoot: findWebRoot(process.env, [join(import.meta.dirname, '../../desktop/dist-web')]),
  mcpLauncher: null,
  waitForLock: false,
});
