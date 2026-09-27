import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import fixPath from 'fix-path';
import type { EngineService } from '@code-manager/engine';
import { appConfigFromEnv, engineFromEnv, startServer, type RunningServer } from '@code-manager/server';

// A GUI launch gets launchd's minimal PATH. gh and claude live in
// /opt/homebrew/bin and ~/.local/bin, so take PATH from the login shell.
fixPath();

// Otherwise userData lands under the npm package name, "@code-manager/desktop".
app.setName('code-manager');

let engine: EngineService | null = null;
let server: RunningServer | null = null;

function openExternalLink(url: string): void {
  if (url.startsWith('https://')) {
    void shell.openExternal(url);
  }
}

async function openWindow(apiUrl: string, token: string): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    title: 'code-manager',
    // The renderer draws its own 52px title bar and leaves 88px on the left
    // for the traffic lights; this centres them in that bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      // Read by the preload script, see src/preload/index.ts.
      additionalArguments: [`--code-manager-api=${apiUrl}`, `--code-manager-token=${token}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Links (e.g. "GitHub") open in the browser; the app window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternalLink(url);
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

async function start(): Promise<void> {
  // The token keeps other local processes and web pages from driving the API.
  const token = randomBytes(24).toString('hex');
  // CODE_MANAGER_FAKE=1 runs on sample data, see engineFromEnv.
  // CODE_MANAGER_ALLOW_WRITES=1 unblocks GitHub writes in the UI, see appConfigFromEnv.
  engine = engineFromEnv();
  server = await startServer({ engine, port: 0, token, config: appConfigFromEnv() });
  await openWindow(server.url, token);
}

async function shutdown(): Promise<void> {
  try {
    // Queued mark-reads are sent, not dropped: the user meant to clear them.
    await engine?.flushPendingWrites();
    await engine?.close();
  } catch (error) {
    console.error('shutdown:', error);
  }
  await server?.close();
}

let quitting = false;

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }
  quitting = true;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(start).catch((error: unknown) => {
  console.error('startup failed:', error);
  app.quit();
});
