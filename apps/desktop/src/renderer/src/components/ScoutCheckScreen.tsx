import { useState } from 'react';
import type { ScoutCantSee, ScoutCheckResult, ScoutTrial } from '@postpile/core';
import { checkedLead, exampleRef, fitLook, trialHeading, trialNote, type FitTone } from '../lib/scout-intro.ts';
import { ScoutCheckedArt } from './ScoutIntroArt.tsx';

const FIT_BOXES: Record<FitTone, { box: string; mark: string }> = {
  safe: { box: 'bg-safe-soft', mark: 'var(--safe)' },
  amber: { box: 'bg-amber-soft', mark: 'var(--amber)' },
  neutral: { box: 'bg-subtle inset-ring inset-ring-edge-hairline', mark: 'var(--muted)' },
};

/** A filled round mark: a check for a fit, "!" for anything to look at. */
function RoundMark(props: { fill: string; check: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="mt-px shrink-0">
      <circle cx="8" cy="8" r="7" fill={props.fill} />
      {props.check ? (
        <path d="M4.8 8.2l2.1 2.1 4.3-4.5" fill="none" stroke="var(--on-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 4.2v4.6M8 11.2v0.3" stroke="var(--on-ink)" strokeWidth="1.9" strokeLinecap="round" />
      )}
    </svg>
  );
}

function FitBox(props: { fit: ScoutCheckResult['fit'] }) {
  const look = fitLook(props.fit.verdict);
  const box = FIT_BOXES[look.tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 ${box.box}`}>
      <RoundMark fill={box.mark} check={look.tone === 'safe'} />
      <span className="text-[12.5px] leading-[1.45] text-ink">
        <strong className="font-semibold">{look.lead}</strong> {props.fit.note}
      </span>
    </div>
  );
}

/** "Drop that part" shows only when the part can be cut from the prompt word for word (`rewrite`). */
function CantSeeBox(props: { cantSee: ScoutCantSee; onKeep: () => void; onDrop: (() => void) | null }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-amber-soft px-3 py-2.5">
      <RoundMark fill="var(--amber)" check={false} />
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] leading-[1.45] text-ink">
          <strong className="font-semibold">One part it can't see.</strong> “{props.cantSee.part}”: {props.cantSee.why}
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={props.onKeep} className="rounded-control bg-surface px-2.5 py-1 text-xs text-amber-ink inset-ring inset-ring-amber hover:bg-subtle">
            Keep it anyway
          </button>
          {props.onDrop && (
            <button type="button" onClick={props.onDrop} title="Takes that part out of the prompt" className="px-1.5 py-1 text-xs text-amber-ink underline hover:text-ink">
              Drop that part
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function TrialSection(props: { trial: ScoutTrial | null; repos: string[] }) {
  const { trial } = props;
  const note = trialNote(trial);
  const examples = trial?.examples ?? [];
  return (
    <div className="flex flex-col gap-2">
      {trial && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-ink">{trialHeading(trial)}</span>
          {examples.length > 0 && <span className="text-[11.5px] text-hint">for example</span>}
        </div>
      )}
      {examples.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-[10px] inset-ring inset-ring-edge-hairline">
          {examples.map((example) => (
            <li key={example.prKey} className="flex items-start gap-2.5 border-b border-hairline px-3 py-[9px] last:border-b-0">
              <span className={`shrink-0 font-mono text-[11.5px] text-hint ${props.repos.length > 1 ? '' : 'w-[46px]'}`}>{exampleRef(example.prKey, props.repos)}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-ink [overflow-wrap:anywhere]">{example.title}</span>
                <span className="text-xs text-ink-2">{example.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-[11.5px] leading-normal text-hint">{note}</p>}
    </div>
  );
}

/**
 * The card after "Check scout" (design canvas "Scouts intro", Check): the
 * name to keep, whether the prompt fits what a scout reads, the one part it
 * can't see with Keep or Drop, and what the dry run would have pulled.
 * Nothing is saved until "Turn on scout" (the card's footer). The path
 * hints in `result.paths` go along unseen; they are edited in scouts.md.
 */
export function ScoutCheckScreen(props: {
  result: ScoutCheckResult;
  repos: string[];
  name: string;
  onName: (name: string) => void;
  onDropPart: (rewrite: string) => void;
}) {
  const { result } = props;
  const [cantSeeOpen, setCantSeeOpen] = useState(true);
  const cantSee = cantSeeOpen ? result.cantSee : null;
  return (
    <>
      <div className="flex items-center gap-3.5">
        <ScoutCheckedArt />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="scout-intro-title" className="text-[17px] font-[650] text-ink">
            Your scout, checked
          </h2>
          <p className="text-[12.5px] text-hint">{checkedLead(result.trial, props.repos)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <label htmlFor="scout-name" className="w-11 text-xs font-semibold text-ink">
          Name
        </label>
        <input
          id="scout-name"
          value={props.name}
          onChange={(event) => props.onName(event.target.value)}
          className="min-w-0 flex-1 rounded-row border border-control bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none select-text focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-2">
        <FitBox fit={result.fit} />
        {cantSee && (
          <CantSeeBox
            cantSee={cantSee}
            onKeep={() => setCantSeeOpen(false)}
            onDrop={
              cantSee.rewrite === null
                ? null
                : () => {
                    props.onDropPart(cantSee.rewrite!);
                    setCantSeeOpen(false);
                  }
            }
          />
        )}
      </div>
      <TrialSection trial={result.trial} repos={props.repos} />
    </>
  );
}
