import type { AgentPurpose } from './runner.ts';

// Glances fire per PR and must come back in seconds; the small model is
// enough to compress one PR. Full id, not the "haiku" alias: ghatchup saw the
// alias resolve to a Sonnet model with user settings loaded.
const GLANCE_MODEL = 'claude-haiku-4-5';
const DEFAULT_MODEL = 'sonnet';

export function modelFor(purpose: AgentPurpose): string {
  if (purpose === 'glance') {
    return process.env.CODE_MANAGER_GLANCE_MODEL || GLANCE_MODEL;
  }
  return process.env.CODE_MANAGER_MODEL || DEFAULT_MODEL;
}
