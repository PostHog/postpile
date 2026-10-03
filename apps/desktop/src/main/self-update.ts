import { UPGRADE_COMMAND, type InstallState, type InstallStatus, type UpdateView } from '@postpile/core';

// The app updates itself: electron-updater finds the newest release on
// GitHub (latest-mac.yml next to the zip), downloads the zip and hands it to
// Squirrel.Mac, which stages it and swaps the app bundle when PostPile quits.
// "Restart to update" quits right away. The release check in the server still
// decides when the title bar reminder shows; this decides what it offers.
// No Electron import here, so the rules run in plain tests; index.ts passes
// electron-updater's autoUpdater and Electron's own autoUpdater in.

// The same timing as the release check (apps/server/src/update-check.ts), so
// both find a new release at about the same time.
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** How the app updates itself: the real installer, a sample state (POSTPILE_FAKE=1) or not at all. */
export type SelfUpdateMode = 'real' | 'fake' | 'off';

export function selfUpdateMode(options: { env: NodeJS.ProcessEnv; packaged: boolean; fake: boolean }): SelfUpdateMode {
  if (options.env.POSTPILE_UPDATE_CHECK === '0' || options.env.POSTPILE_AUTO_UPDATE === '0') {
    return 'off';
  }
  if (options.fake) {
    return 'fake';
  }
  // A dev run is the Electron binary: there is no app bundle to replace.
  return options.packaged ? 'real' : 'off';
}

/** What the rest of main needs from a self-updater. */
export interface SelfUpdate {
  current(): InstallState;
  /** Calls back on every change; returns the unsubscribe. */
  onChange(listener: (state: InstallState) => void): () => void;
  /** Checks now (and downloads what it finds); never throws. Answers the state after the check. */
  check(): Promise<InstallState>;
  start(): void;
  stop(): void;
  /** Installs the staged update and relaunches. Main has shut the engine down before. */
  install(): void;
}

/** The parts of electron-updater's autoUpdater used here (stubbed in tests). */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** With autoDownload, the answer carries the download, which electron-updater never awaits itself. */
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(): void;
}

/**
 * Electron's own autoUpdater (Squirrel.Mac). Its update-downloaded comes
 * after Squirrel staged the update; electron-updater's own event comes
 * earlier, when the zip is only downloaded.
 */
export interface NativeUpdater {
  on(event: 'update-downloaded', listener: () => void): unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One state change at a time, to every listener. Shared by the three self-updaters below. */
class InstallStateHolder {
  private state: InstallState;
  private readonly listeners = new Set<(state: InstallState) => void>();

  constructor(initial: InstallState) {
    this.state = initial;
  }

  get(): InstallState {
    return this.state;
  }

  set(state: InstallState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  subscribe(listener: (state: InstallState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** POSTPILE_AUTO_UPDATE=0, the update check off, or a dev run: the reminder offers the brew command. */
export class SelfUpdateOff implements SelfUpdate {
  private readonly holder = new InstallStateHolder({ status: 'off', version: null, error: null });

  current(): InstallState {
    return this.holder.get();
  }

  onChange(listener: (state: InstallState) => void): () => void {
    return this.holder.subscribe(listener);
  }

  check(): Promise<InstallState> {
    return Promise.resolve(this.current());
  }

  start(): void {}

  stop(): void {}

  install(): void {}
}

/**
 * Sample data (POSTPILE_FAKE=1): a staged update by default, so "Restart to
 * update" can be looked at. POSTPILE_FAKE_INSTALL=downloading, failed or off
 * shows the other states. A restart only relaunches the same app.
 */
export class FakeSelfUpdate implements SelfUpdate {
  private readonly holder: InstallStateHolder;

  constructor(
    status: InstallStatus,
    private readonly relaunch: () => void,
  ) {
    // No version of its own: the sample release check's version shows instead.
    this.holder = new InstallStateHolder({ status, version: null, error: status === 'failed' ? 'Sample download failure' : null });
  }

  current(): InstallState {
    return this.holder.get();
  }

  onChange(listener: (state: InstallState) => void): () => void {
    return this.holder.subscribe(listener);
  }

  check(): Promise<InstallState> {
    return Promise.resolve(this.current());
  }

  start(): void {}

  stop(): void {}

  install(): void {
    this.relaunch();
  }
}

/** POSTPILE_FAKE_INSTALL: ready (the default), downloading, failed or off. */
export function fakeInstallStatus(value: string | undefined): InstallStatus {
  if (value === 'downloading' || value === 'failed' || value === 'off') {
    return value;
  }
  return 'ready';
}

/**
 * The real installer. Downloads on its own as soon as a check finds a newer
 * release (autoDownload), and a staged update installs on any quit
 * (autoInstallOnAppQuit), so "Later" never loses it. Once staged it stops
 * checking: a newer release then comes with the next check after the restart.
 */
export class SelfUpdater implements SelfUpdate {
  private readonly holder = new InstallStateHolder({ status: 'idle', version: null, error: null });
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly updater: Updater,
    native: NativeUpdater,
    private readonly log: (message: string) => void = (message) => console.log(message),
  ) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => this.set('checking', this.current().version));
    updater.on('update-available', (info) => this.set('downloading', info.version));
    updater.on('update-not-available', () => this.set('idle', null));
    updater.on('error', (error) => this.fail(error));
    native.on('update-downloaded', () => this.set('ready', this.current().version));
  }

  private set(status: InstallStatus, version: string | null): void {
    // A late event (a second check's "not available") never takes back a staged update.
    if (this.current().status === 'ready' && status !== 'ready') {
      return;
    }
    this.holder.set({ status, version, error: null });
  }

  private fail(error: unknown): void {
    if (this.current().status === 'ready') {
      return;
    }
    const message = messageOf(error);
    this.log(`self-update failed: ${message}`);
    this.holder.set({ status: 'failed', version: this.current().version, error: message });
  }

  current(): InstallState {
    return this.holder.get();
  }

  onChange(listener: (state: InstallState) => void): () => void {
    return this.holder.subscribe(listener);
  }

  async check(): Promise<InstallState> {
    const status = this.current().status;
    if (status === 'ready' || status === 'checking' || status === 'downloading') {
      return this.current();
    }
    try {
      const result = await this.updater.checkForUpdates();
      // The download runs on after the check. A failed one already came as an
      // "error" event; without this catch it would also be an unhandled rejection.
      result?.downloadPromise?.catch(() => {});
    } catch (error) {
      // A failed check usually came as an "error" event first; log it once.
      if (this.current().status !== 'failed') {
        this.fail(error);
      }
    }
    return this.current();
  }

  start(): void {
    this.stop();
    this.firstTimer = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.repeatTimer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.firstTimer.unref?.();
    this.repeatTimer.unref?.();
  }

  stop(): void {
    if (this.firstTimer) {
      clearTimeout(this.firstTimer);
    }
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
    }
    this.firstTimer = null;
    this.repeatTimer = null;
  }

  install(): void {
    this.updater.quitAndInstall();
  }
}

/** The dialog after the app menu's "Check for Updates…". `restart` adds a "Restart Now" button. */
export interface MenuCheckAnswer {
  message: string;
  detail: string;
  restart: boolean;
}

const BREW_DETAIL = `Update with ${UPGRADE_COMMAND}, then quit and reopen PostPile.`;

/** What "Check for Updates…" says, from both checks: the release check (`view`) and the installer (`install`). */
export function menuCheckAnswer(view: UpdateView, install: InstallState): MenuCheckAnswer {
  const latest = view.latest?.version ?? null;
  if (install.status === 'ready') {
    const version = install.version ?? latest;
    return {
      message: version ? `PostPile ${version} is ready to install` : 'An update is ready to install',
      detail: 'Restart now, or it installs the next time PostPile quits.',
      restart: true,
    };
  }
  if (install.status === 'checking' || install.status === 'downloading') {
    const version = install.version ?? latest;
    return {
      message: version ? `Downloading PostPile ${version}` : 'Checking for updates',
      detail: 'The title bar offers a restart once it is ready.',
      restart: false,
    };
  }
  if (install.status === 'failed') {
    return { message: 'The update could not be downloaded', detail: `${install.error ?? 'Unknown error'}\n\n${BREW_DETAIL}`, restart: false };
  }
  if (latest) {
    return { message: `PostPile ${latest} is out`, detail: BREW_DETAIL, restart: false };
  }
  if (view.error) {
    return { message: 'Could not check for updates', detail: view.error, restart: false };
  }
  if (!view.checkedAt) {
    return { message: 'Update checks are off', detail: 'POSTPILE_UPDATE_CHECK=0 is set.', restart: false };
  }
  return { message: 'PostPile is up to date', detail: `${view.current} is the newest version.`, restart: false };
}
