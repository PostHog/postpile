import type { Glance, GlanceGap, GlanceState, Verdict } from '@postpile/core';

export interface GlanceStateText {
  /** Short, for the verdict pill on a tile. */
  pill: string;
  /** One sentence for the glance card. */
  card: string;
  /** The raw reason behind a failed glance, for a tooltip only; empty otherwise. */
  detail: string;
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

/** "It reads this one in the next sync, in about 42 min.", without the time while auto sync is off. */
function nextSyncText(nextAutoSyncAt: string | null, now: Date): string {
  if (nextAutoSyncAt === null) {
    return 'It reads this one in the next sync.';
  }
  const minutes = Math.ceil((new Date(nextAutoSyncAt).getTime() - now.getTime()) / 60_000);
  return minutes <= 1 ? 'It reads this one in the next sync, in about a minute.' : `It reads this one in the next sync, in about ${minutes} min.`;
}

/**
 * What to say where a PR has no current glance, from the server's
 * glanceState. Replaces "the next sync picks it up": glances catch up right
 * after the poll now, so the words say what is actually happening.
 */
export function glanceStateText(input: GlanceStateInput): GlanceStateText {
  const quiet = { detail: '', spinner: false, retry: false, problem: false };
  switch (input.state) {
    case 'writing':
      return { ...quiet, pill: 'Writing glance', card: 'Writing the glance…', spinner: true };
    case 'queued':
      return { ...quiet, pill: 'Glance queued', card: 'Glance queued. The agent writes it as soon as its topic is up.' };
    case 'failed':
      return {
        ...quiet,
        pill: 'Glance failed',
        // The gap's detail is the parser's own reason ("left out of the answer"): tooltip only.
        card: 'Glance failed: the agent gave no usable answer for this PR.',
        detail: input.gap?.detail ?? '',
        retry: true,
        problem: true,
      };
    case 'agent_off':
      return { ...quiet, pill: 'Agent off', card: 'Agent features are off or paused, so no glance is written. The note above the topics says why.' };
    case 'capped': {
      const limit = input.gap?.reason === 'daily_cap' ? "PostPile used up today's agent calls." : 'PostPile ran out of agent calls in the last sync.';
      return { ...quiet, pill: 'Not looked at yet', card: `Not looked at yet: ${limit} ${nextSyncText(input.nextAutoSyncAt, input.now)}` };
    }
    case 'none':
      return { ...quiet, pill: 'No glance', card: 'No glance: merged and closed PRs get none.' };
    case 'ready':
      return { ...quiet, pill: 'No glance yet', card: 'No glance yet.' };
  }
}

/** The verdict as the app words it everywhere: "Looks safe", "Look closer", "Not yours". */
export const VERDICT_WORDS: Record<Verdict, string> = { LOOKS_SAFE: 'Looks safe', LOOK_CLOSER: 'Look closer', NOT_YOURS: 'Not yours' };

/** The whole glance as one claim, for "Recheck this assessment". */
export function glanceClaim(glance: Glance): string {
  const parts = [`${VERDICT_WORDS[glance.verdict]}.`, glance.forYou, glance.does && `Does: ${glance.does}`, glance.risk && `Risk: ${glance.risk}`, glance.othersSaid && `Others: ${glance.othersSaid}`];
  return parts.filter((part) => part).join(' ');
}
