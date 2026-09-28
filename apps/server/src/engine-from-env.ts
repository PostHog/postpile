import type { AppConfig } from '@code-manager/core';
import { createEngine, type EngineService } from '@code-manager/engine';
import { FakeEngine } from './fake/fake-engine.ts';

function isFake(): boolean {
  return process.env.CODE_MANAGER_FAKE === '1';
}

/** Set CODE_MANAGER_FAKE=1 to run on the Depot sample data: no GitHub, no agent, no database. */
export function engineFromEnv(): EngineService {
  if (isFake()) {
    return new FakeEngine();
  }
  return createEngine();
}

/** Default agent-call cap for app syncs. A full first sync is ~120 calls; this spreads it over a few. */
export const DEFAULT_SYNC_CALL_CAP = 30;

/** CODE_MANAGER_MAX_AGENT_CALLS, when it is a whole number >= 0; the default otherwise. */
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
    syncCallCap: syncCallCapFromEnv(process.env.CODE_MANAGER_MAX_AGENT_CALLS),
  };
}

/** How often the desktop app polls GitHub notifications, as Julian asked for. */
export const DEFAULT_POLL_SECONDS = 10;

/** CODE_MANAGER_POLL_SECONDS: whole seconds >= 0 (0 turns the poll off); the default otherwise. */
export function pollSecondsFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_POLL_SECONDS;
}
