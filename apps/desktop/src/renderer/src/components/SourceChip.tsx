import type { FactRef } from '@postpile/core';
import { refLabel } from '../lib/memory.ts';

const chip = 'flex h-[17px] shrink-0 items-center rounded border border-hairline bg-surface px-1.5 font-mono text-[10px] text-muted';

/** Where a fact or dossier line came from, linking to GitHub when the ref has a URL. */
export function SourceChip(props: { source: FactRef }) {
  const label = refLabel(props.source);
  if (!props.source.url) {
    return <span className={chip}>{label}</span>;
  }
  return (
    <a href={props.source.url} target="_blank" rel="noreferrer" title="Open the source on GitHub" className={`${chip} hover:border-accent-line hover:text-accent`}>
      {label}
    </a>
  );
}
