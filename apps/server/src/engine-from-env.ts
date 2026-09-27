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
 * GitHub-writing actions (approve, comment, mark read) stay blocked in the UI
 * unless CODE_MANAGER_ALLOW_WRITES=1. Sample data never reaches GitHub, so
 * fake mode allows them to keep every flow clickable.
 */
export function appConfigFromEnv(): AppConfig {
  const fake = isFake();
  return { fake, writesAllowed: fake || process.env.CODE_MANAGER_ALLOW_WRITES === '1' };
}
