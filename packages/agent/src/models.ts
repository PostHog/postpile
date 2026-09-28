import type { AgentPurpose } from './runner.ts';

// Glances used to run on Haiku for speed. A side-by-side run on the same 26 PRs
// showed Sonnet judging the user's angle better (verdicts, "for you" lines)
// for about 1.5x the latency and 3x the cost, so both now use Sonnet.
// POSTPILE_GLANCE_MODEL=claude-haiku-4-5 brings Haiku back (full id, not
// the "haiku" alias, which ghatchup saw resolve to Sonnet with user settings).
const GLANCE_MODEL = 'sonnet';
const DEFAULT_MODEL = 'sonnet';
// The daily work context sweep reads a lot of loose notes and has to judge
// what is work and what is private; the user is on a subscription, so it gets
// the strongest model. POSTPILE_SWEEP_MODEL overrides it.
const SWEEP_MODEL = 'opus';
// The setup draft is written once and shapes every later prompt, so it gets
// the strongest model too. POSTPILE_SETUP_MODEL overrides it (draft and refine).
const SETUP_MODEL = 'opus';

export function modelFor(purpose: AgentPurpose): string {
  if (purpose === 'glance_batch') {
    return process.env.POSTPILE_GLANCE_MODEL || GLANCE_MODEL;
  }
  if (purpose === 'context_sweep') {
    return process.env.POSTPILE_SWEEP_MODEL || SWEEP_MODEL;
  }
  if (purpose === 'setup_draft' || purpose === 'setup_refine') {
    return process.env.POSTPILE_SETUP_MODEL || SETUP_MODEL;
  }
  return process.env.POSTPILE_MODEL || DEFAULT_MODEL;
}
