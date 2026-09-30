import { useState } from 'react';
import type { SetupDraftSection, SetupSource } from '@postpile/core';
import { SECTION_HINTS, sourceKindWord, sourcesFor } from '../lib/setup.ts';

const chip = 'inline-flex h-[18px] shrink-0 items-center gap-1 rounded border border-hairline bg-surface px-1.5 text-[10.5px] text-muted';

function SourceTag(props: { source: SetupSource }) {
  const { source } = props;
  const body = (
    <>
      <span className="font-semibold text-ink-2">{sourceKindWord(source.kind)}</span>
      <span className="font-mono">{source.label}</span>
    </>
  );
  if (!source.url) {
    return (
      <span className={chip} title={source.detail}>
        {body}
      </span>
    );
  }
  return (
    <a href={source.url} target="_blank" rel="noreferrer" title={source.detail} className={`${chip} hover:border-accent-line hover:text-accent`}>
      {body}
    </a>
  );
}

/** Each line of the agent's version of the section with what it rests on. */
function WhyList(props: { section: SetupDraftSection; sources: SetupSource[] }) {
  if (props.section.claims.length === 0) {
    return <p className="text-[11px] text-faint">No agent lines here; this section is yours to write.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {props.section.claims.map((claim, index) => {
        const cited = sourcesFor(claim.sourceIds, props.sources);
        return (
          <li key={index} className="flex flex-col gap-1">
            <span className="text-[11.5px] text-ink-2">{claim.text}</span>
            <span className="flex flex-wrap gap-1">
              {cited.map((source) => (
                <SourceTag key={source.id} source={source} />
              ))}
              {cited.length === 0 && (
                <span className="text-[11px] text-faint">
                  {claim.fromUser ? 'Your words.' : 'No source cited: a default the agent suggests. Check it.'}
                </span>
              )}
            </span>
            {cited
              .filter((source) => source.kind === 'codeowners' || source.kind === 'digest')
              .map((source) => (
                <span key={source.id} className="font-mono text-[10.5px] whitespace-pre-wrap text-muted">
                  {source.detail}
                </span>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One section of the draft: its text, editable, and "Why?" with the sources
 * of the agent's lines. Edits stay here until Accept; "Why?" always shows the
 * agent's version, so an edited line reads as the user's own.
 */
export function SetupSectionCard(props: { section: SetupDraftSection | undefined; heading: string; body: string; sources: SetupSource[]; onChange: (body: string) => void }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const rows = Math.max(3, props.body.split('\n').length + 1);
  const cited = props.section ? new Set(props.section.claims.flatMap((claim) => claim.sourceIds)).size : 0;
  return (
    <section className="flex flex-col gap-1.5 rounded-tile bg-surface p-3 shadow-tile">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">{props.heading}</h3>
        {props.section && <span className="text-[11px] text-faint">{cited === 1 ? '1 source' : `${cited} sources`}</span>}
        {props.section && (
          <button type="button" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)} className="ml-auto text-[11px] text-faint hover:text-ink-2 hover:underline">
            Why?
          </button>
        )}
      </div>
      {SECTION_HINTS[props.heading] && <p className="text-[11.5px] text-muted">{SECTION_HINTS[props.heading]}</p>}
      <textarea
        className="w-full resize-y rounded-control border border-control bg-surface px-2 py-1.5 font-mono text-[11.5px] leading-[1.6] outline-none select-text focus:border-accent"
        rows={rows}
        value={props.body}
        placeholder="- One point per line, in your words"
        onChange={(event) => props.onChange(event.target.value)}
        aria-label={`Section ${props.heading}`}
      />
      {whyOpen && props.section && (
        <div className="rounded-control bg-subtle px-2.5 py-2">
          <WhyList section={props.section} sources={props.sources} />
        </div>
      )}
    </section>
  );
}
