import type { GlanceGap } from './views.ts';

/**
 * Where a PR's glance stands, for the words the UI shows instead of "the
 * next sync picks it up":
 * - ready: a glance exists (the stale flag says whether it is behind)
 * - queued: waits for a catch-up run or the next sync
 * - writing: a catch-up run for its topic is writing it right now
 * - failed: the agent was asked (twice) and gave no usable answer; Retry
 * - agent_off: claude is missing, logged out or at its limit
 * - capped: a call cap (the sync's, or the daily catch-up cap) stopped first
 * - none: the PR gets no glance (merged, closed, or not in a tile)
 */
export type GlanceState = 'ready' | 'queued' | 'writing' | 'failed' | 'agent_off' | 'capped' | 'none';

/** A catch-up run for the PR's topic: running, one queued follow-up, or none. */
export type CatchUpRunState = 'running' | 'queued' | null;

export interface GlanceStateInput {
  hasGlance: boolean;
  /** The stored glance was made for an older state of the PR, dossier or instructions. */
  stale: boolean;
  /** The PR should have a glance: open, pinged or found, in a tile. */
  wanted: boolean;
  gap: GlanceGap | null;
  agentOff: boolean;
  catchUp: CatchUpRunState;
}

/**
 * Rules first, in order: a current glance is ready; a PR that gets no glance
 * is none (or ready with an old one); a run on its topic says writing or
 * queued; an old glance stays ready (shown as stale); then why it is missing.
 * No reason recorded means it waits for the next run: queued.
 */
export function glanceStateOf(input: GlanceStateInput): GlanceState {
  if (input.hasGlance && !input.stale) {
    return 'ready';
  }
  if (!input.wanted) {
    return input.hasGlance ? 'ready' : 'none';
  }
  if (input.catchUp === 'running') {
    return 'writing';
  }
  if (input.catchUp === 'queued') {
    return 'queued';
  }
  if (input.hasGlance) {
    return 'ready';
  }
  if (input.agentOff) {
    return 'agent_off';
  }
  if (input.gap?.reason === 'failed') {
    return 'failed';
  }
  if (input.gap?.reason === 'call_cap' || input.gap?.reason === 'daily_cap') {
    return 'capped';
  }
  return 'queued';
}
