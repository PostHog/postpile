import type { AgentPurpose } from './runner.ts';

// Glances used to run on Haiku for speed. A side-by-side run on the same 26 PRs
// showed Sonnet judging the user's angle better (verdicts, "for you" lines)
// for about 1.5x the latency and 3x the cost, so both now use Sonnet.
// POSTPILE_GLANCE_MODEL=claude-haiku-4-5 brings Haiku back (full id, not
// the "haiku" alias, which ghatchup saw resolve to Sonnet with user settings).
//
// Pinned to Sonnet 5.5 by full id (2026-09-28). claude CLI 2.1.284 maps the
// "sonnet" alias to claude-sonnet-5-5 too, but the alias moves with CLI
// updates and user settings (ANTHROPIC_DEFAULT_SONNET_MODEL); the full id
// keeps glances and the recorded model the same until changed here. The
// model is part of the glance and set input hashes, so a change here
// regenerates them once.
const SONNET = 'claude-sonnet-5-5';
const GLANCE_MODEL = SONNET;
const DEFAULT_MODEL = SONNET;
// The daily work context sweep reads a lot of loose notes and has to judge
// what is work and what is private; the user is on a subscription, so it gets
// the strongest model. POSTPILE_SWEEP_MODEL overrides it. Opus stays on the
// alias: it should follow the newest Opus.
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
  // The topic tidy reads every topic once and reshapes them without asking: it gets the setup model too.
  if (purpose === 'setup_draft' || purpose === 'setup_refine' || purpose === 'topic_tidy') {
    return process.env.POSTPILE_SETUP_MODEL || SETUP_MODEL;
  }
  return process.env.POSTPILE_MODEL || DEFAULT_MODEL;
}
