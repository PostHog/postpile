import type { Glance, GlanceGap, GlanceState, Verdict } from '@postpile/core';

export interface GlanceStateText {
  /** Short, for the verdict pill on a tile. */
  pill: string;
  /** One sentence for the glance card. */
  card: string;
  /** Writing right now: the pill and card show a small spinner. */
  spinner: boolean;
  /** The glance failed: the card offers Retry. */
  retry: boolean;
  /** Draw it as a problem (failed), not as a quiet wait. */
  problem: boolean;
}

export interface GlanceStateInput {
  state: GlanceState;
  gap: GlanceGap | null;
  /** From the live status; null while auto sync is off. */
  nextAutoSyncAt: string | null;
  now: Date;
}

/** "next full sync in 42 min", or what writes it when auto sync is off. */
function nextSyncText(nextAutoSyncAt: string | null, now: Date): string {
  if (nextAutoSyncAt === null) {
    return 'the next sync writes it';
  }
  const minutes = Math.ceil((new Date(nextAutoSyncAt).getTime() - now.getTime()) / 60_000);
  return minutes <= 1 ? 'next full sync in a minute' : `next full sync in ${minutes} min`;
}

/**
 * What to say where a PR has no current glance, from the server's
 * glanceState. Replaces "the next sync picks it up": glances catch up right
 * after the poll now, so the words say what is actually happening.
 */
export function glanceStateText(input: GlanceStateInput): GlanceStateText {
  const quiet = { spinner: false, retry: false, problem: false };
  switch (input.state) {
    case 'writing':
      return { ...quiet, pill: 'Writing glance', card: 'Writing the glance…', spinner: true };
    case 'queued':
      return { ...quiet, pill: 'Glance queued', card: 'Glance queued. The agent writes it as soon as its topic is up.' };
    case 'failed':
      return {
        ...quiet,
        pill: 'Glance failed',
        card: `Glance failed: the agent gave no usable answer${input.gap?.detail ? ` (${input.gap.detail})` : ''}.`,
        retry: true,
        problem: true,
      };
    case 'agent_off':
      return { ...quiet, pill: 'Agent off', card: 'Agent features are off, so no glance is written. The note above the topics says how to fix it.' };
    case 'capped': {
      const limit = input.gap?.reason === 'daily_cap' ? 'daily agent limit reached' : 'the last sync hit its agent-call cap';
      return { ...quiet, pill: 'Waiting (agent limit)', card: `Waiting: ${limit}, ${nextSyncText(input.nextAutoSyncAt, input.now)}.` };
    }
    case 'none':
      return { ...quiet, pill: 'No glance', card: 'No glance: merged and closed PRs get none.' };
    case 'ready':
      return { ...quiet, pill: 'No glance yet', card: 'No glance yet.' };
  }
}

const VERDICT_WORDS: Record<Verdict, string> = { LOOKS_SAFE: 'Looks safe', LOOK_CLOSER: 'Look closer', NOT_YOURS: 'Not yours' };

/** The whole glance as one claim, for "Recheck this assessment". */
export function glanceClaim(glance: Glance): string {
  const parts = [`${VERDICT_WORDS[glance.verdict]}.`, glance.forYou, glance.does && `Does: ${glance.does}`, glance.risk && `Risk: ${glance.risk}`, glance.othersSaid && `Others: ${glance.othersSaid}`];
  return parts.filter((part) => part).join(' ');
}
