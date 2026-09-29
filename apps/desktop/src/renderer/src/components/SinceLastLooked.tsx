import type { DossierView } from '@postpile/core';
import { fixedText, sinceLastLooked } from '../lib/memory.ts';
import { changePath, lineTarget } from '../lib/sources.ts';
import { dossierBehindNote } from '../lib/staleness.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { MemoryLine } from './MemoryLine.tsx';

function sinceLabel(since: string, now: Date): string {
  const age = ageLabel(since, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/**
 * The most prominent part of the topic header: what moved since the user was
 * last here. `updating`: a sync or a catch-up run for the topic is going, so
 * the newer-events note says "Updating now".
 */
export function SinceLastLooked(props: { dossier: DossierView; topicId: string; updating: boolean }) {
  const now = useNow();
  const { dossier } = props;
  const block = sinceLastLooked(dossier);
  const since = dossier.changesSinceSeen?.since;
  return (
    <section className="flex max-w-[680px] flex-col gap-2 rounded-row border border-accent-line bg-accent-soft px-3.5 py-3">
      {/* Wraps as whole pieces in the narrow tile column instead of breaking words. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-[12.5px] font-semibold whitespace-nowrap text-ink">{block.heading}</h2>
        {since && <span className="font-mono text-[10.5px] whitespace-nowrap text-muted">{sinceLabel(since, now)}</span>}
        {block.counts && <span className="ml-auto font-mono text-[10.5px] whitespace-nowrap text-muted">{block.counts}</span>}
      </div>
      {block.changes.length === 0 && <p className="text-xs text-muted">Nothing new in the dossier since then.</p>}
      {block.changes.map((change) => {
        const path = changePath(dossier, change);
        return (
          <div key={`${change.at}:${change.text}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-2">
            <span className="pt-0.5 font-mono text-[10.5px] text-muted">{ageLabel(change.at, now)}</span>
            <MemoryLine
              correction={{ kind: 'wrong', factId: null, topicId: props.topicId, text: change.text }}
              stale={null}
              corrected={dossier.correctedClaims.includes(change.text)}
              fixedTo={fixedText(dossier, change.text)}
              refs={change.refs}
              why={path === null ? undefined : lineTarget(props.topicId, dossier, path)}
            >
              <span className="text-ink">{change.text}</span>
            </MemoryLine>
          </div>
        );
      })}
      {dossier.eventsBehind > 0 && (
        <p className="text-[11.5px] text-hint">{dossierBehindNote(dossier.eventsBehind, props.updating)}</p>
      )}
    </section>
  );
}
