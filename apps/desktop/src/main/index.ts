import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron';
import fixPath from 'fix-path';
import { applyLegacyEnv, DataDirLockedError, dataDirs, migrateLegacyData, profileFromEnv, type EngineService } from '@postpile/engine';
import { appConfigFromEnv, engineFromEnv, isFake, pollSecondsFromEnv, startServer, type RunningServer } from '@postpile/server';
import { MacNotifier } from './mac-notifier.ts';

// A GUI launch (Finder, Dock, the packaged app) gets launchd's minimal PATH.
// gh and claude live in /opt/homebrew/bin and ~/.local/bin, so take PATH
// from the login shell, and add the usual install folders in case the shell
// setup does not export them.
fixPath();
const toolFolders = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')];
const pathParts = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
process.env.PATH = [...pathParts, ...toolFolders.filter((folder) => !pathParts.includes(folder))].join(delimiter);

applyLegacyEnv();
// A dev run (pnpm desktop, not the packaged app) gets its own database in
// PostPile-dev, so it never touches the real one. POSTPILE_PROFILE,
// POSTPILE_DATA_DIR and POSTPILE_DB still win when set.
if (!app.isPackaged && process.env.POSTPILE_PROFILE === undefined) {
  process.env.POSTPILE_PROFILE = 'dev';
}
// Before Electron touches userData: it is the same folder as the database, and
// the one-time move from the code-manager folder wants the new one absent.
// The move only targets the real folder and never runs in dev.
if (!isFake()) {
  migrateLegacyData();
}

// Otherwise userData lands under the npm package name, "@postpile/desktop".
// Also the name in the menu bar and the About box.
app.setName('PostPile');
app.setAppUserModelId('com.postpile.app');
app.setAboutPanelOptions({ applicationName: 'PostPile' });
if (profileFromEnv(process.env) === 'dev') {
  app.setPath('userData', process.env.POSTPILE_DATA_DIR || dataDirs().dataDir);
}

// A second launch of the same app (same userData) only focuses the first
// window. A dev run and the packaged app have different userData; the
// database lock keeps those two apart when they share a database.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) {
  app.quit();
}

// apps/desktop/build, next to out/. Only there in a dev checkout; the packaged
// app takes its icon from build/icon.icns through electron-builder.
const iconFile = join(import.meta.dirname, '../../build/icon.png');

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
    title: 'PostPile',
    // Linux and Windows; macOS takes the Dock icon instead.
    icon: iconFile,
    // The renderer draws its own 52px title bar and leaves 88px on the left
    // for the traffic lights; this centres them in that bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f7f8fa',
    // Shown on ready-to-show (first paint), so the window never appears as an
    // empty frame with only the traffic lights for the ~80 ms before React paints.
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      // Read by the preload script, see src/preload/index.ts.
      additionalArguments: [`--postpile-api=${apiUrl}`, `--postpile-token=${token}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());
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
      window.webContents.send('postpile:swipe', direction === 'left' ? 'back' : 'forward');
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
  // A dev run is the Electron binary, which shows the Electron icon in the Dock.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(iconFile));
  }
  // The token keeps other local processes and web pages from driving the API.
  const token = randomBytes(24).toString('hex');
  // POSTPILE_FAKE=1 runs on sample data, see engineFromEnv.
  // GitHub writes stay off until the footer lock is opened (kept in the store); POSTPILE_READ_ONLY=1 forces off.
  try {
    engine = engineFromEnv({ lockKind: app.isPackaged ? 'packaged' : 'dev' });
  } catch (error) {
    if (error instanceof DataDirLockedError) {
      const holder = error.holder;
      dialog.showMessageBoxSync({
        type: 'warning',
        message: `PostPile is already running with this database (pid ${holder.pid}, ${holder.kind})`,
        detail: `Started ${holder.startedAt}.\n${holder.databaseFile}\n\nQuit that one first, or wait until it is done.`,
        buttons: ['Quit'],
      });
      app.exit(1);
      return;
    }
    throw error;
  }
  server = await startServer({ engine, port: 0, token, config: appConfigFromEnv() });
  mainWindow = await openWindow(server.url, token);
  // A click opens the tile: show the window, then let the renderer navigate.
  const notifier = new MacNotifier({
    enabled: process.env.POSTPILE_MAC_NOTIFICATIONS !== '0',
    onClick: (target) => {
      showWindow();
      if (target) {
        mainWindow?.webContents.send('postpile:open-ping', target);
      }
    },
  });
  // The fast notification poll runs as long as the app does, window open or not.
  engine.startLivePoll({
    intervalSeconds: pollSecondsFromEnv(process.env.POSTPILE_POLL_SECONDS),
    onNotify: (notifications) => notifier.show(notifications),
  });
  // "What you're working on": checked now and every 30 minutes, runs once a day from 06:00.
  engine.startWorkContextSchedule();
}

async function shutdown(): Promise<void> {
  try {
    engine?.stopLivePoll();
    engine?.stopWorkContextSchedule();
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
  // Everything is flushed and closed by now, so exit directly. A second
  // app.quit() here never reached will-quit when the quit came from SIGTERM.
  void shutdown().finally(() => app.exit(0));
});

// kill <pid> (SIGTERM) or Ctrl+C in a terminal: the same flush-and-quit as Cmd+Q.
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());

// Dock icon click with the window hidden.
app.on('activate', () => showWindow());

// Another launch of this app: show the window we have.
app.on('second-instance', () => showWindow());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(() => (firstInstance ? start() : undefined)).catch((error: unknown) => {
  console.error('startup failed:', error);
  app.quit();
});
