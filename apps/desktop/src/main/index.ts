import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import fixPath from 'fix-path';
import type { EngineService } from '@code-manager/engine';
import { appConfigFromEnv, engineFromEnv, pollSecondsFromEnv, startServer, type RunningServer } from '@code-manager/server';
import { MacNotifier } from './mac-notifier.ts';

// A GUI launch gets launchd's minimal PATH. gh and claude live in
// /opt/homebrew/bin and ~/.local/bin, so take PATH from the login shell.
fixPath();

// Otherwise userData lands under the npm package name, "@code-manager/desktop".
app.setName('code-manager');

let engine: EngineService | null = null;
let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;
// Set by Cmd+Q (before-quit). Until then, closing the window only hides it on macOS.
let quitting = false;

function openExternalLink(url: string): void {
  if (url.startsWith('https://')) {
    void shell.openExternal(url);
  }
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function openWindow(apiUrl: string, token: string): Promise<BrowserWindow> {
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
  // Trackpad swipe -> back / forward in the renderer's own history. macOS only
  // sends this when System Settings > Trackpad > "Swipe between pages" allows
  // the classic swipe (two or three fingers); the default two-finger scroll
  // gesture does not reach it.
  window.on('swipe', (_event, direction) => {
    if (direction === 'left' || direction === 'right') {
      window.webContents.send('code-manager:swipe', direction === 'left' ? 'back' : 'forward');
    }
  });
  // Like other macOS apps: the red button hides the window and the app keeps
  // running (and polling) in the dock; Cmd+Q quits.
  window.on('close', (event) => {
    if (process.platform === 'darwin' && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return window;
}

async function start(): Promise<void> {
  // The token keeps other local processes and web pages from driving the API.
  const token = randomBytes(24).toString('hex');
  // CODE_MANAGER_FAKE=1 runs on sample data, see engineFromEnv.
  // CODE_MANAGER_ALLOW_WRITES=1 unblocks GitHub writes in the UI, see appConfigFromEnv.
  engine = engineFromEnv();
  server = await startServer({ engine, port: 0, token, config: appConfigFromEnv() });
  mainWindow = await openWindow(server.url, token);
  // A click opens the tile: show the window, then let the renderer navigate.
  const notifier = new MacNotifier({
    enabled: process.env.CODE_MANAGER_MAC_NOTIFICATIONS !== '0',
    onClick: (target) => {
      showWindow();
      if (target) {
        mainWindow?.webContents.send('code-manager:open-ping', target);
      }
    },
  });
  // The fast notification poll runs as long as the app does, window open or not.
  engine.startLivePoll({
    intervalSeconds: pollSecondsFromEnv(process.env.CODE_MANAGER_POLL_SECONDS),
    onNotify: (notifications) => notifier.show(notifications),
  });
}

async function shutdown(): Promise<void> {
  try {
    engine?.stopLivePoll();
    // Queued mark-reads are sent, not dropped: the user meant to clear them.
    await engine?.flushPendingWrites();
    await engine?.close();
  } catch (error) {
    console.error('shutdown:', error);
  }
  await server?.close();
}

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }
  quitting = true;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

// Dock icon click with the window hidden.
app.on('activate', () => showWindow());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(start).catch((error: unknown) => {
  console.error('startup failed:', error);
  app.quit();
});
