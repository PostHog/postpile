import type { PrDetail, PrSummary, TileView } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { glanceGapText } from '../lib/glance.ts';
import { provenanceReason } from '../lib/pr.ts';
import { Button } from './Button.tsx';
import { ProvenanceTag, VerdictPill } from './pills.tsx';

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

/** The agent's take on the PR, written against the user's own instructions. */
export function GlanceCard(props: GlanceCardProps) {
  const actions = useActions();
  const { glance, glanceStale, glanceGap } = props.detail;
  const summary = props.summary;
  const canUnrelate = props.view.tile.kind === 'set' && summary?.provenance.kind === 'pulled_in';
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-hairline-soft bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictPill verdict={glance?.verdict ?? null} stale={glanceStale} gap={glanceGap} />
        {summary && <ProvenanceTag provenance={summary.provenance} />}
        {summary && <span className="text-[11.5px] text-muted">{provenanceReason(summary.provenance)}</span>}
      </div>
      {glance ? (
        <p className="text-[13px] leading-normal font-medium select-text">{glance.forYou}</p>
      ) : (
        <p className="text-xs text-muted">{glanceGapText(glanceGap).card}</p>
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
