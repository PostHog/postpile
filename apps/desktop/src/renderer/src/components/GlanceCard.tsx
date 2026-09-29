import type { PrDetail, PrSummary, TileView, Verdict } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useNextAutoSyncAt } from '../api/live.ts';
import { assessment, type AssessmentLine, type AssessmentMark } from '../lib/assessment.ts';
import { glanceStateText } from '../lib/glance.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { SpinnerIcon } from './icons.tsx';
import { KeyFiles } from './KeyFiles.tsx';

interface GlanceCardProps {
  detail: PrDetail;
  /** The PR as it sits in the selected tile, for its provenance and "for whom" there. */
  summary: PrSummary | null;
  view: TileView;
}

/** Box 1 takes the verdict's look: honey to look closer, green when safe, grey when not yours. */
const VERDICT_BOX: Record<Verdict, { box: string; mark: string }> = {
  LOOK_CLOSER: { box: 'border-move-line bg-move text-honey-ink', mark: 'bg-mark-honey text-honey-ink' },
  LOOKS_SAFE: { box: 'border-safe-line bg-safe-soft text-safe', mark: 'bg-mark-safe text-safe' },
  NOT_YOURS: { box: 'border-hairline bg-segment text-muted', mark: 'bg-chip text-ink-2' },
};

const RISK_BOX = { box: 'border-risk-line bg-status-bad-soft text-status-bad', mark: 'bg-mark-risk text-status-bad' };

function Mark(props: { mark: AssessmentMark | '→' | '“'; tone: string }) {
  return <span className={`flex size-5 items-center justify-center rounded-md text-[10.5px] font-extrabold ${props.tone}`}>{props.mark}</span>;
}

function MarkedLine(props: { line: AssessmentLine; tone: string }) {
  return (
    <span className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 text-[12.5px] leading-[1.4] text-ink select-text">
      <Mark mark={props.line.mark} tone={props.tone} />
      <span className="pt-px">{props.line.text}</span>
    </span>
  );
}

function Box(props: { title: string; tag: string; look: { box: string; mark: string }; lines: AssessmentLine[] }) {
  return (
    <div className={`flex flex-col gap-2 rounded-[10px] border p-3 ${props.look.box}`}>
      <span className="flex items-center gap-2">
        <span className="text-[10.5px] font-extrabold tracking-[0.06em]">{props.title}</span>
        {props.tag && <span className="text-[10.5px] opacity-80">{props.tag}</span>}
      </span>
      {props.lines.map((line) => (
        <MarkedLine key={`${line.mark}${line.text}`} line={line} tone={props.look.mark} />
      ))}
    </div>
  );
}

function PlainLine(props: { mark: '→' | '“'; label: string; text: string }) {
  if (!props.text) {
    return null;
  }
  return (
    <span className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 text-[12.5px] leading-[1.4] text-ink-2 select-text">
      <Mark mark={props.mark} tone="bg-segment text-ink-2" />
      <span className="pt-px">
        <span className="font-[650] text-ink">{props.label}</span> {props.text}
      </span>
    </span>
  );
}

/**
 * Where a missing glance stands, in words (DESIGN.md "Glance catch-up"):
 * writing with a spinner, queued, waiting for a limit, agent off, or failed
 * with Retry, which runs a catch-up for the PR's topic.
 */
function MissingGlance(props: { detail: PrDetail }) {
  const actions = useActions();
  const nextAutoSyncAt = useNextAutoSyncAt();
  const now = useNow();
  const { pr, glanceState, glanceGap } = props.detail;
  const text = glanceStateText({ state: glanceState, gap: glanceGap, nextAutoSyncAt, now });
  const busy = actions.isBusy(`retryGlance:${pr.key}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className={`flex items-center gap-1.5 text-xs ${text.problem ? 'text-status-bad' : 'text-muted'}`}>
        {text.spinner && <SpinnerIcon />}
        {text.card}
      </p>
      {text.retry && (
        <Button disabled={busy} title="Ask the agent again: one catch-up run for this PR's topic" onClick={() => void actions.retryGlance(pr.key)}>
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * The agent's assessment of the PR (mockup ForWhom2 part 2, variant 1):
 * box 1 is titled with the verdict and holds the for-you lines, box 2
 * "RISK · level" the agent's risks (never an auto CI line, none for a low
 * risk), then plain Does and Others lines.
 * The verdict and the risk level each show once. Pulled-in stack layers get
 * no glance; the card says so.
 */
export function GlanceCard(props: GlanceCardProps) {
  const actions = useActions();
  const { glance, glanceStale } = props.detail;
  const summary = props.summary;
  const stackLayer = summary?.provenance.kind === 'pulled_in' && !glance;
  // Sets are grouped by the agent among pinged PRs; any member can be wrong there.
  const canUnrelate = props.view.tile.kind === 'set';
  const view = glance ? assessment(glance, summary?.forWhom ?? null) : null;
  return (
    <div className="flex flex-col gap-3">
      {view && <Box title={view.title} tag={view.tag} look={VERDICT_BOX[view.verdict]} lines={view.lines} />}
      {view?.risk && <Box title="RISK" tag={view.risk.level ? `· ${view.risk.level}` : ''} look={RISK_BOX} lines={view.risk.lines} />}
      {view && (view.does || view.others) && (
        <div className="flex flex-col gap-2">
          <PlainLine mark="→" label="Does:" text={view.does} />
          <PlainLine mark="“" label="Others:" text={view.others} />
        </div>
      )}
      {glance && <KeyFiles keyFiles={glance.keyFiles} pr={props.detail.pr} />}
      {!glance && !stackLayer && <MissingGlance detail={props.detail} />}
      {stackLayer && (
        <p className="text-xs text-muted">Pulled in to complete the stack. Stack layers get no glance until GitHub pings you about them.</p>
      )}
      {glanceStale && (
        <p className="text-[11.5px] text-closer">
          {props.detail.glanceState === 'writing'
            ? 'This assessment is older than the PR or your instructions. A new one is being written.'
            : 'This assessment is older than the PR or your instructions. The next catch-up or sync refreshes it.'}
        </p>
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
