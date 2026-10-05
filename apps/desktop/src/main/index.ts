import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { arch, homedir, release } from 'node:os';
import {
  applyLegacyEnv,
  DataDirLockedError,
  dataDirs,
  defaultPaths,
  launchToolPath,
  migrateLegacyData,
  profileFromEnv,
  telemetryFromEnv,
  type EngineService,
  type Telemetry,
} from '@postpile/engine';
import type { InterruptionsMode, MacNotification, McpLauncher } from '@postpile/core';
import { appConfigFromEnv, engineFromEnv, isFake, pollSecondsFromEnv, startServer, updateSourceFromEnv, type RunningServer, type UpdateSource } from '@postpile/server';
import { externalLinkProblem, isAppPage } from './app-page.ts';
import { ConsolidationSchedule } from './consolidation-schedule.ts';
import { FileLog, logDirFromEnv } from './file-log.ts';
import { ActiveDayReporter } from './active-day.ts';
import { BoardWatcher } from './board-watcher.ts';
import { MacNotifier } from './mac-notifier.ts';
import { OpenedPrs } from './opened-prs.ts';
import { fakeInstallStatus, FakeSelfUpdate, menuCheckAnswer, SelfUpdateOff, selfUpdateMode, SelfUpdater, type SelfUpdate } from './self-update.ts';
import { firstLaunchOnce, welcomeOnce } from './welcome.ts';

const REPO_URL = 'https://github.com/PostHog/postpile';

applyLegacyEnv();
// A dev run (pnpm desktop, not the packaged app) gets its own database in
// PostPile-dev, so it never touches the real one. POSTPILE_PROFILE,
// POSTPILE_DATA_DIR and POSTPILE_DB still win when set.
if (!app.isPackaged && process.env.POSTPILE_PROFILE === undefined) {
  process.env.POSTPILE_PROFILE = 'dev';
}
const fileLog = new FileLog(logDirFromEnv(profileFromEnv(process.env) === 'dev'));
fileLog.captureConsole();
fileLog.captureUnhandled();
// A GUI launch (Finder, Dock, the packaged app) gets launchd's minimal PATH.
// gh and claude live in Homebrew, ~/.local/bin (the Claude Code installer)
// or ~/.claude/local. PATH is built from plain file reads (/etc/paths,
// /etc/paths.d, toolPath in config.json), never by running the login shell:
// that ran the user's whole zsh setup in PostPile's name and macOS asked for
// permissions for whatever it touched. After the profile is set, so the dev
// run reads the dev config.json, and after the log capture, so a broken
// config.json shows up in the log. The tool status (GET /api/tools) looks
// programs up on this same PATH.
process.env.PATH = launchToolPath({ envPath: process.env.PATH ?? '', home: homedir(), configFile: defaultPaths().configFile ?? '' });
console.log(
  `PostPile ${app.getVersion()} starting: pid ${process.pid}, ${app.isPackaged ? 'packaged' : 'dev run'}, profile ${profileFromEnv(process.env)}, PATH ${process.env.PATH}`,
);
// One Telemetry instance for the whole process: main-process events below,
// and the same instance is handed to engineFromEnv/startServer so the
// engine's own events and the renderer's POST /api/telemetry share it.
// Off by default in dev/fake/tests (DESIGN.md "Usage analytics"); flushed by
// Engine.close() in shutdown() below.
const telemetry: Telemetry = telemetryFromEnv({
  env: process.env,
  appVersion: app.getVersion(),
  osVersion: release(),
  arch: arch(),
  telemetryIdFile: isFake() ? undefined : defaultPaths().telemetryIdFile,
});
process.on('uncaughtException', (error) => telemetry.captureException(error));
process.on('unhandledRejection', (reason) => telemetry.captureException(reason));
// Before Electron touches userData: it is the same folder as the database, and
// the one-time move from the code-manager folder wants the new one absent.
// The move only targets the real folder and never runs in dev.
if (!isFake()) {
  migrateLegacyData();
}

// Otherwise userData lands under the npm package name, "@postpile/desktop".
// Also the name in the menu bar and the About box.
app.setName('PostPile');
// Same as appId in electron-builder.yml.
app.setAppUserModelId('com.posthog.postpile');
// PostPile › About PostPile. The version is the desktop package.json version.
app.setAboutPanelOptions({
  applicationName: 'PostPile',
  // A dev run is the Electron binary, whose own bundle version macOS would show otherwise.
  // With both the same, macOS shows the version once.
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: 'Copyright © 2026 PostHog Inc. MIT licensed.',
  credits: 'Alpha. Runs on your Mac only, talks to GitHub through gh and to Anthropic through the claude CLI.',
  website: REPO_URL,
});
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
// The bundled renderer page; the only page (besides the dev server) that gets the API token.
const rendererFile = join(import.meta.dirname, '../renderer/index.html');

/**
 * How Claude Code starts the read-only MCP server: the launcher in
 * Contents/Resources (electron-builder's extraResources) when packaged, the
 * repo's `pnpm cli mcp` in a dev run (apps/desktop is the app path). Only the
 * packaged one is ever added by the app itself, and only on a click.
 */
function mcpLauncher(): McpLauncher {
  if (app.isPackaged) {
    return { kind: 'app', path: join(process.resourcesPath, 'postpile-mcp') };
  }
  return { kind: 'dev', repoRoot: join(app.getAppPath(), '..', '..') };
}

let engine: EngineService | null = null;
let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;
let boardWatcher: BoardWatcher | null = null;
let consolidationSchedule: ConsolidationSchedule | null = null;
// The release check behind the title bar reminder (also asked by "Check for Updates…").
let updates: UpdateSource | null = null;
// Downloads and installs releases; replaced in start() unless self-update is off.
let selfUpdate: SelfUpdate = new SelfUpdateOff();
// Set by Cmd+Q (before-quit) or "Restart to update". Until then, closing the window only hides it on macOS.
let quitting = false;
// The shutdown runs once, whether Cmd+Q or the restart started it; once done, a quit goes straight through.
let shutdownPromise: Promise<void> | null = null;
let shutdownDone = false;
// PRs opened on github.com from the app; refreshed when the window gets focus back.
const openedPrs = new OpenedPrs();

function openExternalLink(url: string): void {
  const problem = externalLinkProblem(url);
  if (problem) {
    console.log(`dropped a link, ${problem}: ${url.slice(0, 200)}`);
    return;
  }
  openedPrs.remember(url, Date.now());
  telemetry.capture('opened_on_github', {});
  void shell.openExternal(url);
}

// window_focused, at most once per WINDOW_FOCUS_TELEMETRY_MS: a retention
// signal ("did they come back to the app"), not a click counter.
const WINDOW_FOCUS_TELEMETRY_MS = 30 * 60_000;
let lastWindowFocusTelemetryMs = 0;

// app_active once per local calendar day while the app runs (daily / weekly
// active users and retention). Checked at launch, on focus and every 30 minutes,
// so a Mac that stays up past midnight still counts the new day.
const ACTIVE_DAY_CHECK_MS = 30 * 60_000;
// How often the live status is checked for a board change (Dock badge, pings in Notification Center).
const BOARD_CHECK_MS = 5_000;
let activeDay: ActiveDayReporter | null = null;
// The board shape snapshot (tile_shape, topic_shape): once per local day, after a full sync ran to the end.
let boardShapeDay: ActiveDayReporter | null = null;

function checkActiveDay(): void {
  activeDay?.check(new Date());
}

function reportWindowFocused(): void {
  checkActiveDay();
  const now = Date.now();
  if (now - lastWindowFocusTelemetryMs >= WINDOW_FOCUS_TELEMETRY_MS) {
    lastWindowFocusTelemetryMs = now;
    telemetry.capture('window_focused', {});
  }
}

/**
 * Back in the app: one poll cycle now (the engine skips it when one started
 * in the last 15 seconds), plus a direct look at the PRs the user opened
 * from here in the last 30 minutes, so an approve, merge or comment made on
 * github.com shows on the tile right away.
 */
function refreshOnFocus(): void {
  engine?.refreshOnFocus(openedPrs.active(Date.now())).catch((error: unknown) => console.error('refresh on focus failed:', error));
}

async function shutdown(): Promise<void> {
  try {
    engine?.stopAgentRequests();
    engine?.stopLivePoll();
    engine?.stopAutoSync();
    engine?.stopWorkContextSchedule();
    consolidationSchedule?.stop();
    selfUpdate.stop();
    // Queued mark-reads are sent, not dropped: the user meant to clear them.
    await engine?.flushPendingWrites();
    await engine?.close();
  } catch (error) {
    console.error('shutdown:', error);
  }
  await server?.close();
}

function shutdownOnce(): Promise<void> {
  shutdownPromise ??= shutdown().finally(() => {
    shutdownDone = true;
  });
  return shutdownPromise;
}

/** The self-updater for this run (DESIGN.md "Self-update"): the real one only in the packaged app. */
function createSelfUpdate(): SelfUpdate {
  const mode = selfUpdateMode({ env: process.env, packaged: app.isPackaged, fake: isFake() });
  console.log(`self-update: ${mode}`);
  if (mode === 'real') {
    return new SelfUpdater(electronUpdater.autoUpdater, nativeAutoUpdater);
  }
  if (mode === 'fake') {
    return new FakeSelfUpdate(fakeInstallStatus(process.env.POSTPILE_FAKE_INSTALL), () => {
      app.relaunch();
      app.exit(0);
    });
  }
  return new SelfUpdateOff();
}

// If the restart has not quit the app by then (a stuck flush, or Squirrel.Mac
// failed), the current version starts again: the engine is stopped or closed
// by then, so staying open is no use. Counted from the click, shutdown included.
const INSTALL_FALLBACK_MS = 60_000;

/**
 * "Restart to update": the same flush-and-close as Cmd+Q, then Squirrel.Mac
 * swaps the app bundle and starts the new version. `quitting` first, so the
 * windows may close and before-quit does not shut down a second time.
 */
async function restartToUpdate(): Promise<void> {
  if (quitting || selfUpdate.current().status !== 'ready') {
    return;
  }
  quitting = true;
  console.log(`restarting to install PostPile ${selfUpdate.current().version ?? '(sample)'}`);
  setTimeout(() => {
    console.error('the update did not install, starting the current version again');
    app.relaunch();
    app.exit(0);
  }, INSTALL_FALLBACK_MS).unref();
  await shutdownOnce();
  selfUpdate.install();
}

/** Tells the window the install state changed; the renderer also re-reads the release check then. */
function sendInstallState(): void {
  mainWindow?.webContents.send('postpile:install-state', selfUpdate.current());
}

/** PostPile › Check for Updates…: both checks now, then a dialog with what they found. */
async function checkForUpdatesFromMenu(): Promise<void> {
  if (!updates) {
    return;
  }
  const [view, install] = await Promise.all([updates.check(), selfUpdate.check()]);
  sendInstallState();
  const answer = menuCheckAnswer(view, install);
  const options = { type: 'info' as const, message: answer.message, detail: answer.detail };
  if (!answer.restart) {
    await dialog.showMessageBox(options);
    return;
  }
  const { response } = await dialog.showMessageBox({ ...options, buttons: ['Restart Now', 'Later'], defaultId: 0, cancelId: 1 });
  if (response === 0) {
    await restartToUpdate();
  }
}

/**
 * The standard macOS menus (the app menu holds About PostPile and Check for
 * Updates…), plus Help › Reveal Logs, which shows main.log in Finder, and
 * links to the repo and its issues. Kept close to Electron's default menu so
 * the usual shortcuts (copy, paste, reload, zoom) keep working.
 */
function setAppMenu(): void {
  const menu = Menu.buildFromTemplate([
    // Electron's own app menu, with Check for Updates… under About.
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void checkForUpdatesFromMenu() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Reveal Logs', click: () => shell.showItemInFolder(fileLog.file) },
        { type: 'separator' },
        { label: 'PostPile on GitHub', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
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

/**
 * The preload asks for the API URL and token over a sync ipc call instead of
 * reading them from the command line, where every local user sees them in
 * `ps`. Only the app's own page gets an answer.
 */
function serveConnection(apiUrl: string, token: string): void {
  ipcMain.on('postpile:connection', (event) => {
    const url = event.senderFrame?.url ?? '';
    if (isAppPage(url, rendererFile, process.env.ELECTRON_RENDERER_URL)) {
      event.returnValue = { apiUrl, token };
    } else {
      console.log(`refused the API connection to ${url.slice(0, 200)}`);
      event.returnValue = null;
    }
  });
}

/**
 * No web permission is ever granted (camera, mic, location, notifications
 * from the page...), except writing to the clipboard from the app's own
 * page ("Copy path"). Mac notifications come from the main process.
 */
function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const own = isAppPage(webContents.getURL(), rendererFile, process.env.ELECTRON_RENDERER_URL);
    const allowed = own && permission === 'clipboard-sanitized-write';
    if (!allowed) {
      console.log(`denied the ${permission} permission to ${webContents.getURL().slice(0, 200)}`);
    }
    callback(allowed);
  });
}

async function openWindow(): Promise<BrowserWindow> {
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
      // Read by the preload script, see src/preload/index.ts. Nothing secret here: the token goes over ipc.
      additionalArguments: [`--postpile-version=${app.getVersion()}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  // Only "Restart to update" really closes it (Cmd+Q exits without closing):
  // a failed install must not leave showWindow() a destroyed window.
  window.on('closed', () => {
    mainWindow = null;
  });
  window.on('focus', refreshOnFocus);
  window.on('focus', reportWindowFocused);
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
    await window.loadFile(rendererFile);
  }
  return window;
}

/**
 * Where a clicked ping goes is looked up now, on the board as it is: the
 * tiles and topics it pointed at may have moved since it pinged. Without a
 * target (its PRs and topic are gone) the click only showed the window.
 */
async function openPing(notification: MacNotification): Promise<void> {
  try {
    const target = (await engine?.pingClickTarget(notification)) ?? null;
    if (target) {
      mainWindow?.webContents.send('postpile:open-ping', target);
    } else if (notification.prKeys.length > 0) {
      console.log(`mac ping click: ${notification.prKeys.join(', ')} and its topic left the board, only showed the window`);
    }
  } catch (error) {
    console.warn('mac ping click:', error);
  }
}

async function start(): Promise<void> {
  setAppMenu();
  denyPermissions();
  // A dev run is the Electron binary, which shows the Electron icon in the Dock.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(iconFile));
  }
  // The token keeps other local processes and web pages from driving the API.
  const token = randomBytes(24).toString('hex');
  // POSTPILE_FAKE=1 runs on sample data, see engineFromEnv.
  // GitHub writes stay off until the footer lock is opened (kept in the store); POSTPILE_READ_ONLY=1 forces off.
  try {
    // The legacy folder move already ran at the top of this file, before userData existed.
    engine = engineFromEnv({
      lockKind: app.isPackaged ? 'packaged' : 'dev',
      migrateLegacy: false,
      telemetry,
      mcpLauncher: mcpLauncher(),
      appVersion: app.getVersion(),
    });
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
  const config = appConfigFromEnv();
  // The title bar's update reminder asks GitHub for releases ~30s after start, then every 6 hours.
  updates = updateSourceFromEnv(app.getVersion());
  server = await startServer({ engine, port: 0, token, config, updates, telemetry, onWrite: () => void boardWatcher?.refresh() });
  console.log(
    `server on ${server.url}, database ${config.databasePath ?? 'none (sample data)'}, sync call cap ${config.syncCallCap}, auto sync ${config.autoSyncMinutes > 0 ? `every ${config.autoSyncMinutes} min` : 'off'}`,
  );
  serveConnection(server.url, token);
  // The self-updater checks on the release check's clock; the reminder asks
  // for its state, hears every change and asks for the restart.
  selfUpdate = createSelfUpdate();
  selfUpdate.onChange(sendInstallState);
  ipcMain.handle('postpile:install-state', () => selfUpdate.current());
  ipcMain.on('postpile:restart-to-update', () => void restartToUpdate());
  selfUpdate.start();
  telemetry.capture('app_launched', { first_launch: firstLaunchOnce(app.getPath('userData')) });
  activeDay = new ActiveDayReporter(join(app.getPath('userData'), 'telemetry-active-day'), () => telemetry.capture('app_active', {}));
  checkActiveDay();
  setInterval(checkActiveDay, ACTIVE_DAY_CHECK_MS).unref();
  boardShapeDay = new ActiveDayReporter(join(app.getPath('userData'), 'telemetry-board-shape-day'), () => void sendBoardShape());
  mainWindow = await openWindow();
  // A click opens the tile: show the window, then let the renderer navigate.
  const notifier = new MacNotifier({
    enabled: process.env.POSTPILE_MAC_NOTIFICATIONS !== '0',
    isWindowFocused: () => mainWindow?.isFocused() ?? false,
    onClick: (notification) => {
      telemetry.capture('mac_ping_clicked', {});
      showWindow();
      void openPing(notification);
    },
  });
  // The Dock badge counts the tiles PostPile pinged about that are not
  // handled yet (DESIGN.md "Interruptions"); a ping leaves Notification
  // Center once its tile is read or done. Both follow the board: poll cycles
  // and syncs (the live status moves), local actions (the API's non-read
  // requests), each new ping and each change of the interruptions pick.
  const board = engine;
  boardWatcher = new BoardWatcher(
    board,
    (snapshot) => {
      app.setBadgeCount(snapshot.badge);
      notifier.closeRead(snapshot.unreadPrKeys);
    },
    (error) => console.warn('board watcher:', error),
  );
  const watcher = boardWatcher;
  void watcher.refresh();
  // A visit to a tile in the app takes its pings out of Notification Center
  // and off the Dock badge (DESIGN.md "Mac notifications").
  ipcMain.on('postpile:tile-visited', (_event, prKeys: unknown) => {
    if (Array.isArray(prKeys) && prKeys.every((key) => typeof key === 'string')) {
      notifier.closeVisited(prKeys);
      void board.pingsVisited(prKeys).then(() => watcher.refresh());
    }
  });
  async function sendBoardShape(): Promise<void> {
    try {
      for (const { event, props } of await board.boardShape()) {
        telemetry.capture(event, props);
      }
    } catch (error) {
      console.warn('board shape:', error);
    }
  }
  setInterval(() => void board.livePollStatus().then((status) => watcher.checkStatus(status)), BOARD_CHECK_MS).unref();
  // A full sync ran to the end: the board is fresh, so take the daily snapshot (once per day).
  board.onSyncCompleted(() => boardShapeDay?.check(new Date()));
  // "Send a test notification" in the sidebar's Interruptions menu.
  ipcMain.handle('postpile:test-notification', () => notifier.showTest());
  // Once the user lets PostPile interrupt them (setup or the sidebar): one
  // calm welcome notification, so macOS asks for the permission now and not
  // on the first real ping. Under Never nothing asks, ever.
  function welcomeAfterOptIn(mode: InterruptionsMode): void {
    if (mode !== 'never') {
      welcomeOnce(app.getPath('userData'), () => notifier.showWelcome(mode));
    }
  }
  board.onInterruptionsChange((mode) => {
    welcomeAfterOptIn(mode);
    void watcher.refresh();
  });
  // An earlier pick whose welcome could not show yet (notifications were off), a few seconds after the window shows.
  setTimeout(() => void board.interruptions().then((view) => welcomeAfterOptIn(view.mode)), 3000);
  // The fast notification poll runs as long as the app does, window open or not.
  engine.startLivePoll({
    intervalSeconds: pollSecondsFromEnv(process.env.POSTPILE_POLL_SECONDS),
    onNotify: (notifications) => {
      if (notifier.show(notifications) !== 'shown') {
        return false;
      }
      telemetry.capture('mac_ping_shown', { count: notifications.length });
      // Next tick: the engine records the pings for the Dock badge once this answers.
      setImmediate(() => void watcher.refresh());
      return true;
    },
  });
  // Agents on this Mac (Claude Code through postpile-mcp) leave requests in the
  // data folder: re-read a PR from GitHub, or suggest a topic change for the
  // Inbox. Only while the app runs; the MCP process says so when it does not.
  engine.startAgentRequests();
  // A background full sync every POSTPILE_AUTO_SYNC_MINUTES (default 60, 0 off),
  // counted from the end of the last sync and capped like "Sync now". The
  // engine skips it while a sync runs; the title bar shows it like any sync.
  engine.startAutoSync({ minutes: config.autoSyncMinutes, maxAgentCalls: config.syncCallCap });
  // "What you're working on": checked now and every 30 minutes, runs once a day from 06:00.
  engine.startWorkContextSchedule();
  // Consolidation (merge proposals, facts, retiring): checked every 30 minutes,
  // runs when due, capped like a sync. The engine never lets it overlap a sync.
  const service = engine;
  consolidationSchedule = new ConsolidationSchedule((options) => service.consolidate(options), config.syncCallCap);
  consolidationSchedule.start();
}

app.on('before-quit', (event) => {
  // After a finished shutdown (the restart to update hands over to Squirrel.Mac) the quit goes through.
  if (shutdownDone) {
    return;
  }
  event.preventDefault();
  if (!quitting) {
    quitting = true;
    console.log('quitting: flushing pending writes and closing the database');
  }
  // Everything is flushed and closed by now, so exit directly. A second
  // app.quit() here never reached will-quit when the quit came from SIGTERM.
  // A Cmd+Q during the restart's shutdown waits for it the same way.
  void shutdownOnce().finally(() => app.exit(0));
});

// kill <pid> (SIGTERM) or Ctrl+C in a terminal: the same flush-and-quit as Cmd+Q.
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  app.quit();
});
process.on('SIGINT', () => {
  console.log('SIGINT received');
  app.quit();
});

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
