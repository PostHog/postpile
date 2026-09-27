import type { PrDetail, PrSummary, TileView } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { glanceGapText } from '../lib/glance.ts';
import { whyTitle } from '../lib/why.ts';
import { Button } from './Button.tsx';
import { VerdictPill, WhyBadge } from './pills.tsx';

interface GlanceCardProps {
  detail: PrDetail;
  /** The PR as it sits in the selected tile, for its provenance there. */
  summary: PrSummary | null;
  view: TileView;
}

function GlanceLine(props: { label: string; text: string }) {
  if (!props.text) {
    return null;
  }
  return (
    <>
      <dt className="text-muted">{props.label}</dt>
      <dd className="select-text">{props.text}</dd>
    </>
  );
}

/**
 * The agent's take on the PR, written against the user's own instructions.
 * Pulled-in stack layers get no glance (no agent call); the card says so
 * instead of waiting for one.
 */
export function GlanceCard(props: GlanceCardProps) {
  const actions = useActions();
  const { glance, glanceStale, glanceGap } = props.detail;
  const summary = props.summary;
  const stackLayer = summary?.provenance.kind === 'pulled_in' && !glance;
  // Sets are grouped by the agent among pinged PRs; any member can be wrong there.
  const canUnrelate = props.view.tile.kind === 'set';
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-hairline-soft bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!stackLayer && <VerdictPill verdict={glance?.verdict ?? null} stale={glanceStale} gap={glanceGap} />}
        {summary && <WhyBadge code={summary.why} provenance={summary.provenance} />}
        {summary && <span className="text-[11.5px] text-muted">{whyTitle(summary.why, summary.provenance)}</span>}
      </div>
      {glance && <p className="text-[13px] leading-normal font-medium select-text">{glance.forYou}</p>}
      {!glance && !stackLayer && <p className="text-xs text-muted">{glanceGapText(glanceGap).card}</p>}
      {stackLayer && (
        <p className="text-xs text-muted">Pulled in to complete the stack. Stack layers get no glance until GitHub pings you about them.</p>
      )}
      {glance && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-normal text-ink-2">
          <GlanceLine label="Does" text={glance.does} />
          <GlanceLine label="Risk" text={glance.risk} />
          <GlanceLine label="Others" text={glance.othersSaid} />
        </dl>
      )}
      {glanceStale && (
        <p className="text-[11.5px] text-closer">This glance is older than the PR or your instructions. Sync to refresh it.</p>
      )}
      {canUnrelate && summary && (
        <div>
          <Button
            onClick={() =>
              void actions.feedback({ kind: 'not_related', tileId: props.view.tile.id, prKey: summary.key, targetTopicId: null, note: '' })
            }
          >
            Not related to this set
          </Button>
        </div>
      )}
    </div>
  );
}
