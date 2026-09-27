import type { AgentPurpose } from './runner.ts';

// Glances used to run on Haiku for speed. A side-by-side run on the same 26 PRs
// showed Sonnet judging the user's angle better (verdicts, "for you" lines)
// for about 1.5x the latency and 3x the cost, so both now use Sonnet.
// CODE_MANAGER_GLANCE_MODEL=claude-haiku-4-5 brings Haiku back (full id, not
// the "haiku" alias, which ghatchup saw resolve to Sonnet with user settings).
const GLANCE_MODEL = 'sonnet';
const DEFAULT_MODEL = 'sonnet';

export function modelFor(purpose: AgentPurpose): string {
  if (purpose === 'glance_batch') {
    return process.env.CODE_MANAGER_GLANCE_MODEL || GLANCE_MODEL;
  }
  return process.env.CODE_MANAGER_MODEL || DEFAULT_MODEL;
}
