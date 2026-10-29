import type { ScoutedPrView } from '@postpile/core';
import { scoutedStateText } from '../lib/scouts.ts';

/**
 * Under the PR header of a PR a scout pulled in (DESIGN.md "Scouts"):
 * "Scouted by <name>: <reason>", then where it stands (followed, dismissed,
 * off the section, in the inbox now, a waiting Follow). Muted like an
 * outside agent's note: it says how the PR got here, it asks nothing.
 */
export function ScoutedLine(props: { scouted: ScoutedPrView }) {
  const { scouted } = props;
  return (
    <p className="text-[11.5px] leading-normal text-hint">
      <span className="font-medium text-ink-2">Scouted by {scouted.scoutName}:</span> {scouted.reason}. {scoutedStateText(scouted)}
    </p>
  );
}
