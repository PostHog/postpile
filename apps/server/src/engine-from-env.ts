import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig, McpLauncher } from '@postpile/core';
import { createEngine, DEFAULT_AUTO_SYNC_MINUTES, defaultPaths, migrateLegacyData, profileFromEnv, type EngineService, type LockKind, type Telemetry } from '@postpile/engine';
import { FakeEngine } from './fake/fake-engine.ts';
import { fakeToolProblems } from './fake/fake-tools.ts';
import { FakeUpdates } from './fake/fake-update.ts';
import { UpdateChecker, UpdatesOff, type UpdateSource } from './update-check.ts';

export function isFake(): boolean {
  return process.env.POSTPILE_FAKE === '1';
}

/** Always run from source (tsx), never bundled, so reading this file at runtime is safe. */
export function readOwnVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface EngineFromEnvOptions {
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
 * claude-limit). Otherwise throws DataDirLockedError while another process
 * holds the database.
 */
export function engineFromEnv(options: EngineFromEnvOptions = {}): EngineService {
  if (isFake()) {
    return new FakeEngine({ forceSetup: process.env.POSTPILE_FAKE_SETUP === '1', missingTools: fakeToolProblems(process.env.POSTPILE_FAKE_MISSING) });
  }
  if (options.migrateLegacy ?? true) {
    // A no-op once done, and in dev.
    migrateLegacyData();
  }
  return createEngine({
    lockKind: options.lockKind ?? 'server',
    withoutLock: options.withoutLock,
    appVersion: readOwnVersion(),
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
export function appConfigFromEnv(): AppConfig {
  return {
    fake: isFake(),
    syncCallCap: syncCallCapFromEnv(process.env.POSTPILE_MAX_AGENT_CALLS),
    syncOnStart: process.env.POSTPILE_SYNC_ON_START !== '0',
    profile: profileFromEnv(process.env),
    databasePath: isFake() ? null : defaultPaths().databaseFile,
    autoSyncMinutes: autoSyncMinutesFromEnv(process.env.POSTPILE_AUTO_SYNC_MINUTES, process.env.POSTPILE_SYNC_ON_START !== '0'),
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

/** How often the desktop app polls GitHub notifications. */
export const DEFAULT_POLL_SECONDS = 10;

/** POSTPILE_POLL_SECONDS: whole seconds >= 0 (0 turns the poll off); the default otherwise. */
export function pollSecondsFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_POLL_SECONDS;
}

/**
 * The update reminder's check for the app at `current`. POSTPILE_UPDATE_CHECK=0
 * turns it off. Sample data never asks GitHub: it shows a sample update,
 * unless POSTPILE_FAKE_UPDATE=0.
 */
export function updateSourceFromEnv(current: string): UpdateSource {
  if (process.env.POSTPILE_UPDATE_CHECK === '0') {
    return new UpdatesOff(current);
  }
  if (isFake()) {
    return new FakeUpdates(current, process.env.POSTPILE_FAKE_UPDATE !== '0');
  }
  return new UpdateChecker({ current });
}
