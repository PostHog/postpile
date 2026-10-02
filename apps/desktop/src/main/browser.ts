import { join } from 'node:path';
import { profileFromEnv } from '@postpile/engine';
import { findWebRoot, runStandaloneServer } from '@postpile/server';
import { appVersion } from './app-version.ts';
import { appBundleOf, BROWSER_USAGE, browserCommand, browserUrl } from './browser-command.ts';
import { BROWSER_LOG_FILE_NAME, FileLog, logDirFromEnv } from './file-log.ts';
import { BrowserAgent } from './launch-agent.ts';

const command = browserCommand(process.argv.slice(2));
const bundle = appBundleOf(process.execPath);
const logDir = logDirFromEnv(profileFromEnv(process.env) === 'dev');
const url = browserUrl(process.env.PORT);

function needBundle(): string {
  if (!bundle) {
    console.error('Only the installed app can run at login. From a checkout, use pnpm server.');
    process.exit(1);
  }
  return bundle;
}

async function run(): Promise<void> {
  const log = new FileLog(logDir, undefined, 'browser');
  log.captureConsole();
  log.captureUnhandled();
  await runStandaloneServer({
    appVersion: appVersion(import.meta.dirname),
    install: 'app-browser',
    webRoot: findWebRoot(process.env, [join(import.meta.dirname, '../renderer')]),
    mcpLauncher: bundle ? { kind: 'app', path: join(bundle, 'Contents/Resources/postpile-mcp') } : null,
    waitForLock: true,
  });
}

function atLogin(): void {
  const app = needBundle();
  const result = new BrowserAgent().install([join(app, 'Contents/Resources/postpile'), 'browser']);
  if (!result.ok) {
    console.error(`launchctl could not start it: ${result.output}`);
    process.exit(1);
  }
  console.log(`PostPile runs in the background now and at every login.\nOpen ${url}\nLogs: ${join(logDir, BROWSER_LOG_FILE_NAME)}\nStop it with: postpile browser --stop`);
}

function stop(): void {
  const removed = new BrowserAgent().remove();
  console.log(removed ? 'Stopped. It no longer starts at login.' : 'It was not set to run at login.');
}

function restart(): void {
  const result = new BrowserAgent().restart();
  if (!result.ok) {
    console.error('PostPile is not running in the background. Start it with: postpile browser --at-login');
    process.exit(1);
  }
  console.log(`Restarted. Reload ${url}`);
}

switch (command.kind) {
  case 'run':
    await run();
    break;
  case 'at-login':
    atLogin();
    break;
  case 'stop':
    stop();
    break;
  case 'restart':
    restart();
    break;
  case 'help':
    console.log(BROWSER_USAGE);
    break;
  case 'error':
    console.error(`${command.message}\n\n${BROWSER_USAGE}`);
    process.exit(2);
}
