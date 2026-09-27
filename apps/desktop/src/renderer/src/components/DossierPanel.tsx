import type { ReactNode } from 'react';
import type { DossierCare, DossierView } from '@code-manager/core';
import { claimStaleReason, fixedText } from '../lib/memory.ts';
import { lineTarget } from '../lib/sources.ts';
import { prNumber } from '../lib/tiles.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { MemoryLine } from './MemoryLine.tsx';

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-[0.04em] text-muted">{props.title}</h3>
      {props.children}
    </section>
  );
}

function careText(care: DossierCare): string {
  return care.source === 'observed' ? `${care.text} (observed, unconfirmed)` : `${care.text} (${care.source})`;
}

/** The full dossier behind the "Dossier" disclosure: questions, PRs, cares, people, version history. */
export function DossierPanel(props: { dossier: DossierView; topicId: string }) {
  const now = useNow();
  const { dossier: view, topicId } = props;
  const { dossier } = view;
  const wrong = (text: string) => ({ kind: 'wrong' as const, factId: null, topicId, text });
  const corrected = (text: string) => view.correctedClaims.includes(text);
  const why = (path: string) => lineTarget(topicId, view, path);
  return (
    <div className="flex max-w-[680px] flex-col gap-4 rounded-row border border-hairline bg-surface px-3.5 py-3">
      <Section title="Open questions">
        {dossier.openQuestions.length === 0 && <p className="text-xs text-faint">No open questions.</p>}
        {dossier.openQuestions.map((question, index) => (
          <MemoryLine
            key={question.text}
            correction={wrong(question.text)}
            stale={claimStaleReason(`openQuestions[${index}]`, view.staleClaims)}
            corrected={corrected(question.text)}
            fixedTo={fixedText(view, question.text)}
            refs={question.refs}
            why={why(`openQuestions[${index}]`)}
          >
            {question.text}
            {question.askedBy && <span className="text-muted"> asked by @{question.askedBy}</span>}
          </MemoryLine>
        ))}
      </Section>

      <Section title="PR timeline, oldest first">
        {dossier.timeline.length === 0 && <p className="text-xs text-faint">No PRs in the timeline yet.</p>}
        {dossier.timeline.map((entry, index) => (
          <MemoryLine
            key={entry.prKey}
            correction={wrong(`${entry.prKey}: ${entry.role}`)}
            stale={claimStaleReason(`timeline[${index}]`, view.staleClaims)}
            corrected={corrected(`${entry.prKey}: ${entry.role}`)}
            fixedTo={fixedText(view, `${entry.prKey}: ${entry.role}`)}
            why={why(`timeline[${index}]`)}
          >
            <span className="font-mono text-[11px] text-muted">#{prNumber(entry.prKey)}</span> {entry.role}
          </MemoryLine>
        ))}
        {dossier.earlier && <p className="text-xs text-muted">Earlier: {dossier.earlier}</p>}
      </Section>

      <Section title="What you care about here">
        {dossier.userCares.length === 0 && <p className="text-xs text-faint">Nothing noted yet.</p>}
        {dossier.userCares.map((care, index) => (
          <MemoryLine
            key={care.text}
            correction={wrong(care.text)}
            stale={null}
            corrected={corrected(care.text)}
            fixedTo={fixedText(view, care.text)}
            canForget
            why={why(`userCares[${index}]`)}
          >
            {care.source === 'observed' ? <span className="italic">{careText(care)}</span> : careText(care)}
          </MemoryLine>
        ))}
      </Section>

      <Section title="People">
        {dossier.people.length === 0 && <p className="text-xs text-faint">Nobody noted yet.</p>}
        {dossier.people.map((person) => {
          const text = `@${person.login} ${person.role}: ${person.note}`;
          return (
            <MemoryLine key={person.login} correction={wrong(text)} stale={null} corrected={corrected(text)} fixedTo={fixedText(view, text)}>
              <span className="font-medium text-ink">@{person.login}</span> <span className="text-muted">{person.role}</span>
              {person.note && ` · ${person.note}`}
            </MemoryLine>
          );
        })}
      </Section>

      <Section title="Version history">
        {view.history.map((note) => (
          <div key={note.version} className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 text-xs">
            <span className="font-mono text-[10.5px] text-muted">
              v{note.version} · {ageLabel(note.createdAt, now)}
            </span>
            <span className="flex flex-col gap-0.5 text-ink-2">
              {note.changes.length === 0 && (
                <span className="text-faint">{note.version === 1 ? 'First version.' : 'Reworded, nothing a reader would notice.'}</span>
              )}
              {note.changes.map((change) => (
                <span key={change}>{change}</span>
              ))}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}
