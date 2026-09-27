import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import fixPath from 'fix-path';
import { createEngine, type EngineService } from '@code-manager/engine';
import { startServer, type RunningServer } from '@code-manager/server';

// A GUI launch gets launchd's minimal PATH. gh and claude live in
// /opt/homebrew/bin and ~/.local/bin, so take PATH from the login shell.
fixPath();

// Otherwise userData lands under the npm package name, "@code-manager/desktop".
app.setName('code-manager');

let engine: EngineService | null = null;
let server: RunningServer | null = null;

async function openWindow(apiUrl: string, token: string): Promise<void> {
  const window = new BrowserWindow({ width: 1400, height: 900, title: 'code-manager' });
  const query = { api: apiUrl, token };
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await window.loadURL(`${devUrl}?${new URLSearchParams(query).toString()}`);
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query });
  }
}

async function start(): Promise<void> {
  // The token keeps other local processes and web pages from driving the API.
  const token = randomBytes(24).toString('hex');
  engine = createEngine();
  server = await startServer({ engine, port: 0, token });
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
