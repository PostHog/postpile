import type { GlanceGap } from '@code-manager/core';

export interface GlanceGapText {
  /** Short, for the verdict pill. */
  pill: string;
  /** One sentence for the glance card. */
  card: string;
}

/** What to say where a glance is missing, so a PR the call cap skipped does not look broken. */
export function glanceGapText(gap: GlanceGap | null): GlanceGapText {
  if (gap?.reason === 'call_cap') {
    return { pill: 'Not read yet (call cap)', card: 'Not read yet: the last sync stopped at its agent-call cap first. The next sync picks it up.' };
  }
  if (gap?.reason === 'failed') {
    return { pill: 'Glance failed', card: `The agent gave no usable glance (${gap.detail}). The next sync tries again.` };
  }
  return { pill: 'No glance yet', card: 'No glance yet. The next sync with the agent writes one.' };
}
