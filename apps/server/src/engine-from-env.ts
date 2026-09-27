import { createEngine, type EngineService } from '@code-manager/engine';
import { FakeEngine } from './fake/fake-engine.ts';

/** Set CODE_MANAGER_FAKE=1 to run on the Depot sample data: no GitHub, no agent, no database. */
export function engineFromEnv(): EngineService {
  if (process.env.CODE_MANAGER_FAKE === '1') {
    return new FakeEngine();
  }
  return createEngine();
}
