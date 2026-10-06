import { EventEmitter } from 'node:events';
import type { InstallState, UpdateView } from '@postpile/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeInstallStatus,
  menuCheckAnswer,
  selfUpdateMode,
  SelfUpdater,
  updateErrorCode,
  type NativeUpdater,
  type Updater,
  type UpdateTelemetry,
} from './self-update.ts';

/** electron-updater's autoUpdater as far as SelfUpdater uses it; `check` decides what a check emits. */
class StubUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  installs = 0;
  check: (stub: StubUpdater) => void = () => {};
  download: Promise<unknown> | null = null;

  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null> {
    this.checks += 1;
    this.emit('checking-for-update');
    this.check(this);
    return Promise.resolve({ downloadPromise: this.download });
  }

  quitAndInstall(): void {
    this.installs += 1;
  }
}

function setup() {
  const updater = new StubUpdater();
  const native = new EventEmitter();
  const logged: string[] = [];
  const events: { event: string; props: unknown }[] = [];
  const telemetry: UpdateTelemetry = { capture: (event, props) => events.push({ event, props }) };
  const clock = { nowMs: Date.parse('2026-10-06T19:09:12Z') };
  const selfUpdate = new SelfUpdater(updater as unknown as Updater, native as unknown as NativeUpdater, {
    log: (message) => logged.push(message),
    telemetry,
    now: () => clock.nowMs,
  });
  const seen: InstallState[] = [];
  selfUpdate.onChange((state) => seen.push(state));
  return { updater, native, selfUpdate, seen, logged, events, clock };
}

describe('selfUpdateMode', () => {
  it('runs the real installer only in the packaged app', () => {
    expect(selfUpdateMode({ env: {}, packaged: true, fake: false })).toBe('real');
    expect(selfUpdateMode({ env: {}, packaged: false, fake: false })).toBe('off');
    expect(selfUpdateMode({ env: {}, packaged: true, fake: true })).toBe('fake');
  });

  it('is off with the update check or self-update turned off', () => {
    expect(selfUpdateMode({ env: { POSTPILE_AUTO_UPDATE: '0' }, packaged: true, fake: false })).toBe('off');
    expect(selfUpdateMode({ env: { POSTPILE_UPDATE_CHECK: '0' }, packaged: true, fake: true })).toBe('off');
  });

  it('reads the sample install state, ready by default', () => {
    expect(fakeInstallStatus(undefined)).toBe('ready');
    expect(fakeInstallStatus('downloading')).toBe('downloading');
    expect(fakeInstallStatus('nonsense')).toBe('ready');
  });
});

describe('SelfUpdater', () => {
  it('downloads on its own and installs on quit', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('goes from checking to downloading to ready once Squirrel staged the update', async () => {
    const { updater, native, selfUpdate, seen } = setup();
    updater.check = (stub) => stub.emit('update-available', { version: '0.6.0' });
    expect(await selfUpdate.check('interval')).toEqual({ status: 'downloading', version: '0.6.0', error: null });
    native.emit('update-downloaded');
    expect(seen.map((state) => state.status)).toEqual(['checking', 'downloading', 'ready']);
    expect(selfUpdate.current()).toEqual({ status: 'ready', version: '0.6.0', error: null });
  });

  it('is idle when nothing is newer', async () => {
    const { updater, selfUpdate } = setup();
    updater.check = (stub) => stub.emit('update-not-available');
    expect((await selfUpdate.check('interval')).status).toBe('idle');
  });

  it('keeps a failure with its reason and tries again on the next check', async () => {
    const { updater, selfUpdate, logged } = setup();
    updater.check = (stub) => stub.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(await selfUpdate.check('interval')).toEqual({ status: 'failed', version: null, error: 'net::ERR_INTERNET_DISCONNECTED' });
    expect(logged).toEqual(['self-update failed: net::ERR_INTERNET_DISCONNECTED']);
    updater.check = (stub) => stub.emit('update-not-available');
    expect((await selfUpdate.check('interval')).status).toBe('idle');
  });

  it('turns a rejected check into a failure, never a throw', async () => {
    const { updater, selfUpdate } = setup();
    updater.checkForUpdates = () => Promise.reject(new Error('no app-update.yml'));
    expect(await selfUpdate.check('interval')).toEqual({ status: 'failed', version: null, error: 'no app-update.yml' });
  });

  it('logs a failed check once when electron-updater both emits and rejects', async () => {
    const { updater, selfUpdate, logged } = setup();
    updater.checkForUpdates = () => {
      updater.emit('error', new Error('GitHub answered 404'));
      return Promise.reject(new Error('GitHub answered 404'));
    };
    await selfUpdate.check('interval');
    expect(logged).toEqual(['self-update failed: GitHub answered 404']);
  });

  it('catches a failed download, which electron-updater never awaits', async () => {
    const { updater, selfUpdate } = setup();
    let reject: (error: Error) => void = () => {};
    updater.download = new Promise((_resolve, rejectDownload) => {
      reject = rejectDownload;
    });
    updater.check = (stub) => stub.emit('update-available', { version: '0.6.0' });
    await selfUpdate.check('interval');
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    updater.emit('error', new Error('signature mismatch'));
    reject(new Error('signature mismatch'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(selfUpdate.current()).toEqual({ status: 'failed', version: '0.6.0', error: 'signature mismatch' });
  });

  it('stops checking once staged, and late events never take the restart back', async () => {
    const { updater, native, selfUpdate } = setup();
    updater.check = (stub) => stub.emit('update-available', { version: '0.6.0' });
    await selfUpdate.check('interval');
    native.emit('update-downloaded');
    await selfUpdate.check('interval');
    expect(updater.checks).toBe(1);
    updater.emit('update-not-available');
    updater.emit('error', new Error('late'));
    expect(selfUpdate.current().status).toBe('ready');
  });

  it('hands the install to electron-updater', () => {
    const { updater, selfUpdate } = setup();
    selfUpdate.install();
    expect(updater.installs).toBe(1);
  });
});

describe('SelfUpdater telemetry', () => {
  it('reports each check with what started it and what it found', async () => {
    const { updater, native, selfUpdate, events } = setup();
    updater.check = (stub) => stub.emit('update-not-available');
    await selfUpdate.check('launch');
    updater.check = (stub) => stub.emit('update-available', { version: '0.20.0' });
    await selfUpdate.check('menu');
    native.emit('update-downloaded');
    expect(events).toEqual([
      { event: 'update_check_finished', props: { trigger: 'launch', result: 'none' } },
      { event: 'update_check_finished', props: { trigger: 'menu', result: 'available', available_version: '0.20.0' } },
      { event: 'update_downloaded', props: { version: '0.20.0' } },
    ]);
  });

  it('reports a failed check as an error with a code, never the message', async () => {
    const { updater, selfUpdate, events } = setup();
    updater.check = (stub) => stub.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED at /Users/alice/x'));
    await selfUpdate.check('interval');
    expect(events).toEqual([
      { event: 'update_failed', props: { stage: 'check', error_code: 'ERR_INTERNET_DISCONNECTED' } },
      { event: 'update_check_finished', props: { trigger: 'interval', result: 'error' } },
    ]);
  });

  it('reports a failed download once, after the check found the release', async () => {
    const { updater, selfUpdate, events } = setup();
    updater.check = (stub) => stub.emit('update-available', { version: '0.20.0' });
    await selfUpdate.check('interval');
    updater.emit('error', Object.assign(new Error('sha512 checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }));
    expect(events.map((entry) => entry.event)).toEqual(['update_check_finished', 'update_failed']);
    expect(events[1]?.props).toEqual({ stage: 'download', error_code: 'ERR_CHECKSUM_MISMATCH' });
  });

  it('sends nothing for a check skipped while an update is staged', async () => {
    const { updater, native, selfUpdate, events } = setup();
    updater.check = (stub) => stub.emit('update-available', { version: '0.20.0' });
    await selfUpdate.check('launch');
    native.emit('update-downloaded');
    await selfUpdate.check('interval');
    expect(events.map((entry) => entry.event)).toEqual(['update_check_finished', 'update_downloaded']);
  });
});

describe('updateErrorCode', () => {
  it('prefers the updater code, then the net error, the HTTP status and the class', () => {
    expect(updateErrorCode(Object.assign(new Error('x'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }))).toBe('ERR_UPDATER_LATEST_VERSION_NOT_FOUND');
    expect(updateErrorCode(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe('ERR_NAME_NOT_RESOLVED');
    expect(updateErrorCode(Object.assign(new Error('404 Not Found'), { name: 'HttpError', statusCode: 404 }))).toBe('HTTP_404');
    expect(updateErrorCode(new TypeError('bad'))).toBe('TypeError');
    expect(updateErrorCode(new Error('Code signature at /Applications/PostPile.app did not pass'))).toBe('unknown');
    expect(updateErrorCode('a string')).toBe('unknown');
  });
});

describe('SelfUpdater after a wake', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks a little after the wake when the last check is half an hour old or more', async () => {
    vi.useFakeTimers();
    const { updater, selfUpdate, events, clock } = setup();
    updater.check = (stub) => stub.emit('update-not-available');
    await selfUpdate.check('launch');
    clock.nowMs += 10 * 60 * 60 * 1000;
    selfUpdate.checkAfterWake();
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checks).toBe(2);
    expect(events.at(-1)).toEqual({ event: 'update_check_finished', props: { trigger: 'wake', result: 'none' } });
    selfUpdate.stop();
  });

  it('skips the wake check when a check started less than half an hour ago', async () => {
    vi.useFakeTimers();
    const { updater, selfUpdate, clock } = setup();
    updater.check = (stub) => stub.emit('update-not-available');
    await selfUpdate.check('interval');
    clock.nowMs += 29 * 60 * 1000;
    selfUpdate.checkAfterWake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checks).toBe(1);
  });

  it('checks after a wake when nothing was checked yet, once for several wakes in a row', async () => {
    vi.useFakeTimers();
    const { updater, selfUpdate } = setup();
    selfUpdate.checkAfterWake();
    selfUpdate.checkAfterWake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checks).toBe(1);
  });

  it('never checks after a wake while an update downloads or is staged', async () => {
    vi.useFakeTimers();
    const { updater, native, selfUpdate, clock } = setup();
    updater.check = (stub) => stub.emit('update-available', { version: '0.20.0' });
    await selfUpdate.check('launch');
    clock.nowMs += 60 * 60 * 1000;
    selfUpdate.checkAfterWake();
    await vi.advanceTimersByTimeAsync(30_000);
    native.emit('update-downloaded');
    clock.nowMs += 60 * 60 * 1000;
    selfUpdate.checkAfterWake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checks).toBe(1);
  });

  it('drops a pending wake check on stop', async () => {
    vi.useFakeTimers();
    const { updater, selfUpdate } = setup();
    selfUpdate.checkAfterWake();
    selfUpdate.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checks).toBe(0);
  });
});

describe('menuCheckAnswer', () => {
  const upToDate: UpdateView = { current: '0.5.0', latest: null, checkedAt: '2026-10-03T10:00:00Z', error: null };
  const behind: UpdateView = {
    ...upToDate,
    latest: { version: '0.6.0', url: '', publishedAt: null, notes: '', behindSince: null, releasesBehind: 1, moreBehind: false },
  };

  function install(status: InstallState['status'], version: string | null = null, error: string | null = null): InstallState {
    return { status, version, error };
  }

  it('offers a restart for a staged update', () => {
    expect(menuCheckAnswer(behind, install('ready', '0.6.0'))).toEqual({
      message: 'PostPile 0.6.0 is ready to install',
      detail: 'Restart now, or it installs the next time PostPile quits.',
      restart: true,
    });
  });

  it('says a download is on its way', () => {
    expect(menuCheckAnswer(behind, install('downloading', '0.6.0')).message).toBe('Downloading PostPile 0.6.0');
  });

  it('falls back to brew when the app cannot update itself', () => {
    expect(menuCheckAnswer(behind, install('off')).detail).toBe('Update with brew upgrade --cask postpile, then quit and reopen PostPile.');
    expect(menuCheckAnswer(behind, install('failed', '0.6.0', 'offline')).detail).toContain('offline');
  });

  it('says when it is up to date, could not check, or the check is off', () => {
    expect(menuCheckAnswer(upToDate, install('idle')).message).toBe('PostPile is up to date');
    expect(menuCheckAnswer({ ...upToDate, error: 'GitHub answered 503' }, install('off')).detail).toBe('GitHub answered 503');
    expect(menuCheckAnswer({ ...upToDate, checkedAt: null }, install('off')).message).toBe('Update checks are off');
  });
});
