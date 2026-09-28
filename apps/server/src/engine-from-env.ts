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

/**
 * Default agent-call cap for app syncs. Raised from 30 to 150 (2026-09-28):
 * cost is not a concern (subscription), and a full first sync of ~120 calls
 * now fits in one. The cap still guards against a runaway loop.
 */
export const DEFAULT_SYNC_CALL_CAP = 150;

/** CODE_MANAGER_MAX_AGENT_CALLS, when it is a whole number >= 0; the default otherwise. */
export function syncCallCapFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SYNC_CALL_CAP;
}

/**
 * GitHub-writing actions (approve, comment, mark read) stay blocked in the UI
 * unless CODE_MANAGER_ALLOW_WRITES=1. Sample data never reaches GitHub, so
 * fake mode allows them to keep every flow clickable.
 */
export function appConfigFromEnv(): AppConfig {
  const fake = isFake();
  return {
    fake,
    writesAllowed: fake || process.env.CODE_MANAGER_ALLOW_WRITES === '1',
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
