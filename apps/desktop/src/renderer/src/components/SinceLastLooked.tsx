import type { DossierView } from '@postpile/core';
import { blockRefs, fixedText, leadingPerson, sinceLastLooked } from '../lib/memory.ts';
import { changePath, lineTarget } from '../lib/sources.ts';
import { dossierBehindNote } from '../lib/staleness.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { MemoryLine } from './MemoryLine.tsx';

function sinceLabel(since: string, now: Date): string {
  const age = ageLabel(since, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/** The dot on the timeline rail: the newest entry in accent with a halo, the older ones hollow. */
function RailDot(props: { newest: boolean; last: boolean }) {
  return (
    <span aria-hidden="true" className="flex flex-col items-center pt-1.5">
      <span
        className={`size-[7px] shrink-0 rounded-full ${props.newest ? 'bg-accent ring-[2.5px] ring-accent/16' : 'bg-surface inset-ring-[1.5px] inset-ring-ghost'}`}
      />
      {!props.last && <span className="mt-[3px] w-px flex-1 bg-hairline" />}
    </span>
  );
}

/**
 * The most prominent part of the topic header: what moved since the user was
 * last here, as a ruled heading and a small timeline (no box). `updating`: a
 * sync or a catch-up run for the topic is going, so the newer-events note
 * says "Updating now".
 */
export function SinceLastLooked(props: { dossier: DossierView; topicId: string; updating: boolean }) {
  const now = useNow();
  const { dossier } = props;
  const block = sinceLastLooked(dossier);
  const since = dossier.changesSinceSeen?.since;
  const refs = blockRefs(block.changes);
  const logins = dossier.dossier.people.map((person) => person.login);
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold whitespace-nowrap text-ink">{block.heading}</h2>
        {since && <span className="font-mono text-[10px] whitespace-nowrap text-hint">{sinceLabel(since, now)}</span>}
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-hairline" />
        {block.counts.length > 0 && (
          <span className="flex items-baseline gap-[5px] text-[11px] whitespace-nowrap text-hint">
            {block.counts.map((count, index) => (
              <span key={count.words} className="flex items-baseline gap-[5px]">
                {index > 0 && <span className="text-ghost">·</span>}
                <span>
                  <span className="font-mono text-[10px] font-semibold text-ink-2 tabular-nums">{count.count}</span> {count.words}
                </span>
              </span>
            ))}
          </span>
        )}
      </div>
      {block.changes.length === 0 && <p className="text-xs text-muted">Nothing new in the dossier since then.</p>}
      {block.changes.length > 0 && (
        <div className="flex flex-col">
          {block.changes.map((change, index) => {
            const path = changePath(dossier, change);
            const last = index === block.changes.length - 1;
            const person = leadingPerson(change.text, logins);
            return (
              <div key={`${change.at}:${change.text}`} className="grid grid-cols-[33px_13px_minmax(0,1fr)] gap-x-1.5">
                <span className="pt-0.5 text-right font-mono text-[10px] text-hint tabular-nums">{ageLabel(change.at, now)}</span>
                <RailDot newest={index === 0} last={last} />
                <div className={last ? '' : 'pb-2'}>
                  <MemoryLine
                    correction={{ kind: 'wrong', factId: null, topicId: props.topicId, text: change.text }}
                    stale={null}
                    updating={props.updating}
                    corrected={dossier.correctedClaims.includes(change.text)}
                    fixedTo={fixedText(dossier, change.text)}
                    refs={refs[index]}
                    why={path === null ? undefined : lineTarget(props.topicId, dossier, path)}
                    textClass="text-[12.5px] leading-normal"
                  >
                    {person ? (
                      <>
                        <span className="font-[550] text-ink">{person.login}</span>
                        {person.rest}
                      </>
                    ) : (
                      change.text
                    )}
                  </MemoryLine>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {dossier.eventsBehind > 0 && <p className="pl-[58px] text-[11.5px] text-hint">{dossierBehindNote(dossier.eventsBehind, props.updating)}</p>}
    </section>
  );
}
