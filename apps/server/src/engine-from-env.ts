import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppConfig, AppInstall, McpLauncher } from '@postpile/core';
import { createEngine, DEFAULT_AUTO_SYNC_MINUTES, defaultPaths, migrateLegacyData, profileFromEnv, type EngineService, type LockKind, type Telemetry } from '@postpile/engine';
import { FakeEngine } from './fake/fake-engine.ts';
import { fakeQuotaLevel } from './fake/fake-quota.ts';
import { fakeToolProblems } from './fake/fake-tools.ts';
import { FakeUpdates, type FakeUpdateMode } from './fake/fake-update.ts';
import { UpdateChecker, UpdatesOff, type UpdateSource } from './update-check.ts';

export function isFake(): boolean {
  return process.env.POSTPILE_FAKE === '1';
}

const SERVER_PACKAGE_NAMES = new Set(['@postpile/server', 'postpile-server']);

/**
 * The version in the nearest server package.json above this file: apps/server
 * when run from source (tsx), the postpile-server bundle's root when bundled
 * (apps/service), wherever the bundler put this module.
 */
export function readOwnVersion(fromDir: string = import.meta.dirname): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name && SERVER_PACKAGE_NAMES.has(pkg.name)) {
        return pkg.version ?? 'unknown';
      }
    } catch {
      // no package.json here
    }
    if (dirname(dir) === dir) {
      return 'unknown';
    }
  }
}

export interface EngineFromEnvOptions {
  /** The app's version; defaults to this package's. The desktop app passes its own, which the bundle cannot read from here. */
  appVersion?: string;
  /** Who takes the database lock: the server by default. */
  lockKind?: LockKind;
  /** The CLI's --read-only: read the database while another process holds it, no GitHub writes. */
  withoutLock?: boolean;
  /**
   * Run the one-time move from the code-manager folders first (default).
   * The desktop app passes false: it runs the move itself before Electron
   * creates its userData folder.
   */
  migrateLegacy?: boolean;
  /** Reuse a Telemetry the caller already built (the desktop app's main process); defaults to building one from env. */
  telemetry?: Telemetry;
  /** How Claude Code starts the MCP server (the desktop app knows). Missing: "Add to Claude Code" only shows the command. */
  mcpLauncher?: McpLauncher | null;
}

/**
 * Set POSTPILE_FAKE=1 to run on the Depot sample data: no GitHub, no agent,
 * no database. POSTPILE_FAKE_SETUP=1 on top starts it with no instructions
 * and the setup flow showing. POSTPILE_FAKE_MISSING simulates missing tools
 * (comma separated: gh, gh-auth, gh-token, gh-offline, claude, claude-auth,
 * claude-limit). POSTPILE_FAKE_QUOTA=low or critical simulates a GitHub
 * quota that is low or nearly used. Otherwise throws DataDirLockedError while
 * another process holds the database.
 */
export function engineFromEnv(options: EngineFromEnvOptions = {}): EngineService {
  if (isFake()) {
    return new FakeEngine({
      forceSetup: process.env.POSTPILE_FAKE_SETUP === '1',
      missingTools: fakeToolProblems(process.env.POSTPILE_FAKE_MISSING),
      quota: fakeQuotaLevel(process.env.POSTPILE_FAKE_QUOTA),
      tidyOnFirstSync: process.env.POSTPILE_FAKE_TIDY === '1',
    });
  }
  if (options.migrateLegacy ?? true) {
    // A no-op once done, and in dev.
    migrateLegacyData();
  }
  return createEngine({
    lockKind: options.lockKind ?? 'server',
    withoutLock: options.withoutLock,
    appVersion: options.appVersion ?? readOwnVersion(),
    telemetry: options.telemetry,
    mcpLauncher: options.mcpLauncher,
  });
}

/**
 * Default agent-call cap for app syncs. Raised from 30 to 150 (2026-09-28):
 * cost is not a concern (subscription), and a full first sync of ~120 calls
 * now fits in one. The cap still guards against a runaway loop.
 */
export const DEFAULT_SYNC_CALL_CAP = 150;

/** POSTPILE_MAX_AGENT_CALLS, when it is a whole number >= 0; the default otherwise. */
export function syncCallCapFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SYNC_CALL_CAP;
}

/**
 * Fixed for the process. Whether GitHub writes are on is the engine's
 * runtime switch (footer lock, GET /api/github-writes), not config.
 */
export function appConfigFromEnv(install: AppInstall = 'app'): AppConfig {
  return {
    fake: isFake(),
    syncCallCap: syncCallCapFromEnv(process.env.POSTPILE_MAX_AGENT_CALLS),
    syncOnStart: process.env.POSTPILE_SYNC_ON_START !== '0',
    profile: profileFromEnv(process.env),
    databasePath: isFake() ? null : defaultPaths().databaseFile,
    autoSyncMinutes: autoSyncMinutesFromEnv(process.env.POSTPILE_AUTO_SYNC_MINUTES, process.env.POSTPILE_SYNC_ON_START !== '0'),
    install,
  };
}

/**
 * POSTPILE_AUTO_SYNC_MINUTES: whole minutes >= 0 (0 turns the background
 * sync off); the default otherwise. The default is off when the start sync
 * is off (POSTPILE_SYNC_ON_START=0): runs meant to make no GitHub or agent
 * traffic stay that way unless they ask for auto sync explicitly.
 */
export function autoSyncMinutesFromEnv(value: string | undefined, syncOnStart = true): number {
  const parsed = Number(value);
  if (value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return syncOnStart ? DEFAULT_AUTO_SYNC_MINUTES : 0;
}

/** How often the desktop app polls GitHub notifications, GitHub's usual X-Poll-Interval. */
export const DEFAULT_POLL_SECONDS = 60;

/**
 * POSTPILE_POLL_SECONDS: whole seconds >= 0 (0 turns the poll off); the
 * default otherwise. A lower value only counts until GitHub sends its
 * X-Poll-Interval: the poll never runs faster than that.
 */
export function pollSecondsFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_POLL_SECONDS;
}

/** POSTPILE_FAKE_UPDATE: 0 for no sample update, pill for the small pill, anything else for the bar. */
function fakeUpdateMode(value: string | undefined): FakeUpdateMode {
  if (value === '0') {
    return 'none';
  }
  return value === 'pill' ? 'pill' : 'bar';
}

/**
 * The update reminder's check for the app at `current`. POSTPILE_UPDATE_CHECK=0
 * turns it off. Sample data never asks GitHub: it shows a sample update
 * (see fakeUpdateMode).
 */
export function updateSourceFromEnv(current: string): UpdateSource {
  if (process.env.POSTPILE_UPDATE_CHECK === '0') {
    return new UpdatesOff(current);
  }
  if (isFake()) {
    return new FakeUpdates(current, fakeUpdateMode(process.env.POSTPILE_FAKE_UPDATE));
  }
  return new UpdateChecker({ current });
}
