import type { ReactNode } from 'react';

/**
 * The small label above a detail-pane section: Look at first, Description,
 * Reviews, What the agent knows, the fact names. Line height "normal", not
 * the inherited 1.5, so a one-line label is as tall as its text.
 */
export function SectionLabel(props: { children: ReactNode }) {
  return <span className="text-[11px] leading-[normal] font-semibold tracking-[0.02em] text-hint">{props.children}</span>;
}
