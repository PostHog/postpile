import {
  UPGRADE_COMMAND,
  type InstallState,
  type InstallStatus,
  type TelemetryEventName,
  type TelemetryEventProps,
  type UpdateCheckTrigger,
  type UpdateView,
} from '@postpile/core';

// The app updates itself: electron-updater finds the newest release on
// GitHub (latest-mac.yml next to the zip), downloads the zip and hands it to
// Squirrel.Mac, which stages it and swaps the app bundle when PostPile quits.
// "Restart to update" quits right away. The release check in the server still
// decides when the title bar reminder shows; this decides what it offers.
// No Electron import here, so the rules run in plain tests; index.ts passes
// electron-updater's autoUpdater and Electron's own autoUpdater in.

// The same timing as the release check (apps/server/src/update-check.ts), so
// both find a new release at about the same time. latest-mac.yml is a tiny
// file, so hourly costs nothing.
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
// After a wake. A sleeping Mac runs no timers, so a check that came due
// during sleep would wait for the next tick of the hourly timer (or longer).
// The wake check waits a little for the network to come back, and is skipped
// when a check started in the last half hour (wall clock).
const WAKE_CHECK_DELAY_MS = 30_000;
const WAKE_CHECK_AFTER_MS = 30 * 60 * 1000;

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
  check(trigger: UpdateCheckTrigger): Promise<InstallState>;
  /** The Mac woke up: checks soon, unless a check started in the last half hour. */
  checkAfterWake(): void;
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

/** The update events the self-updater sends; the app's Telemetry fits. */
export interface UpdateTelemetry {
  capture<K extends TelemetryEventName>(event: K, props: TelemetryEventProps<K>): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SAFE_ERROR_CODE = /^[A-Za-z0-9_]{1,40}$/;

/**
 * A short name for an update error that is safe to send: electron-updater's
 * code, Chromium's net error, the HTTP status or the error class. Never the
 * message, which can hold paths and URLs.
 */
export function updateErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && SAFE_ERROR_CODE.test(code)) {
    return code;
  }
  const netError = /net::(ERR_[A-Z0-9_]+)/.exec(error.message)?.[1];
  if (netError && SAFE_ERROR_CODE.test(netError)) {
    return netError;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number' && Number.isInteger(statusCode)) {
    return `HTTP_${statusCode}`;
  }
  if (error.name !== 'Error' && SAFE_ERROR_CODE.test(error.name)) {
    return error.name;
  }
  return 'unknown';
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

  check(_trigger: UpdateCheckTrigger): Promise<InstallState> {
    return Promise.resolve(this.current());
  }

  checkAfterWake(): void {}

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

  check(_trigger: UpdateCheckTrigger): Promise<InstallState> {
    return Promise.resolve(this.current());
  }

  checkAfterWake(): void {}

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

/** What one check found, from electron-updater's events while it ran. */
interface CheckOutcome {
  result: 'none' | 'available' | 'error';
  version: string | null;
}

export interface SelfUpdaterOptions {
  log?: (message: string) => void;
  telemetry?: UpdateTelemetry;
  /** Wall clock in epoch ms; stubbed in tests. */
  now?: () => number;
}

/**
 * The real installer. Downloads on its own as soon as a check finds a newer
 * release (autoDownload), and a staged update installs on any quit
 * (autoInstallOnAppQuit), so "Later" never loses it. Once staged it stops
 * checking: a newer release then comes with the next check after the restart.
 * Every check it runs ends in update_check_finished, so "never checked" and
 * "checked and failed" can be told apart.
 */
export class SelfUpdater implements SelfUpdate {
  private readonly holder = new InstallStateHolder({ status: 'idle', version: null, error: null });
  private readonly log: (message: string) => void;
  private readonly telemetry: UpdateTelemetry | null;
  private readonly now: () => number;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCheckStartedMs: number | null = null;
  // Reset when a check starts, set by the first event that says how it went.
  private outcome: CheckOutcome | null = null;

  constructor(
    private readonly updater: Updater,
    native: NativeUpdater,
    options: SelfUpdaterOptions = {},
  ) {
    this.log = options.log ?? ((message) => console.log(message));
    this.telemetry = options.telemetry ?? null;
    this.now = options.now ?? (() => Date.now());
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => this.set('checking', this.current().version));
    updater.on('update-available', (info) => {
      this.outcome ??= { result: 'available', version: info.version };
      this.set('downloading', info.version);
    });
    updater.on('update-not-available', () => {
      this.outcome ??= { result: 'none', version: null };
      this.set('idle', null);
    });
    updater.on('error', (error) => this.fail(error));
    native.on('update-downloaded', () => this.staged());
  }

  private set(status: InstallStatus, version: string | null): void {
    // A late event (a second check's "not available") never takes back a staged update.
    if (this.current().status === 'ready' && status !== 'ready') {
      return;
    }
    this.holder.set({ status, version, error: null });
  }

  private staged(): void {
    const version = this.current().version;
    if (this.current().status !== 'ready' && version) {
      this.telemetry?.capture('update_downloaded', { version });
    }
    this.set('ready', version);
  }

  private fail(error: unknown): void {
    if (this.current().status === 'ready') {
      return;
    }
    this.outcome ??= { result: 'error', version: null };
    const message = messageOf(error);
    const stage = this.current().status === 'downloading' ? 'download' : 'check';
    this.log(`self-update failed: ${message}`);
    this.telemetry?.capture('update_failed', { stage, error_code: updateErrorCode(error) });
    this.holder.set({ status: 'failed', version: this.current().version, error: message });
  }

  private beginCheck(): void {
    this.lastCheckStartedMs = this.now();
    this.outcome = null;
  }

  private reportCheck(trigger: UpdateCheckTrigger): void {
    const outcome = this.outcome ?? { result: 'none', version: null };
    if (outcome.result === 'available' && outcome.version) {
      this.telemetry?.capture('update_check_finished', { trigger, result: 'available', available_version: outcome.version });
      return;
    }
    this.telemetry?.capture('update_check_finished', { trigger, result: outcome.result });
  }

  current(): InstallState {
    return this.holder.get();
  }

  onChange(listener: (state: InstallState) => void): () => void {
    return this.holder.subscribe(listener);
  }

  async check(trigger: UpdateCheckTrigger): Promise<InstallState> {
    const status = this.current().status;
    if (status === 'ready' || status === 'checking' || status === 'downloading') {
      return this.current();
    }
    this.beginCheck();
    try {
      const result = await this.updater.checkForUpdates();
      // The download runs on after the check. A failed one already came as an
      // "error" event; without this catch it would also be an unhandled rejection.
      result?.downloadPromise?.catch(() => {});
    } catch (error) {
      // A failed check usually came as an "error" event first; log it once.
      if (this.outcome?.result !== 'error') {
        this.fail(error);
      }
    }
    this.reportCheck(trigger);
    return this.current();
  }

  checkAfterWake(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
    }
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      const sinceLastMs = this.lastCheckStartedMs === null ? null : this.now() - this.lastCheckStartedMs;
      if (sinceLastMs !== null && sinceLastMs < WAKE_CHECK_AFTER_MS) {
        return;
      }
      void this.check('wake');
    }, WAKE_CHECK_DELAY_MS);
    this.wakeTimer.unref?.();
  }

  start(): void {
    this.stop();
    this.firstTimer = setTimeout(() => void this.check('launch'), FIRST_CHECK_MS);
    this.repeatTimer = setInterval(() => void this.check('interval'), CHECK_EVERY_MS);
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
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
    }
    this.firstTimer = null;
    this.repeatTimer = null;
    this.wakeTimer = null;
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
