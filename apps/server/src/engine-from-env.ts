import type { AppConfig } from '@postpile/core';
import { createEngine, type EngineService } from '@postpile/engine';
import { FakeEngine } from './fake/fake-engine.ts';

export function isFake(): boolean {
  return process.env.POSTPILE_FAKE === '1';
}

/** Set POSTPILE_FAKE=1 to run on the Depot sample data: no GitHub, no agent, no database. */
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
  };
}

/** How often the desktop app polls GitHub notifications, as Julian asked for. */
export const DEFAULT_POLL_SECONDS = 10;

/** POSTPILE_POLL_SECONDS: whole seconds >= 0 (0 turns the poll off); the default otherwise. */
export function pollSecondsFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_POLL_SECONDS;
}
