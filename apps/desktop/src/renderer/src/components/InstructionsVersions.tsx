import { useState } from 'react';
import type { InstructionsVersionView } from '@code-manager/core';
import { diffCounts, lineDiff } from '../lib/diff.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { DiffView } from './DiffView.tsx';

function originText(version: InstructionsVersionView): string {
  if (version.origin === 'chat') {
    return version.sourceText ? `From chat: “${version.sourceText}”` : 'From chat';
  }
  return version.version === 1 ? 'Found on disk' : 'Edited outside the app';
}

function VersionRow(props: { version: InstructionsVersionView; previous: InstructionsVersionView | undefined }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const { version, previous } = props;
  const before = previous?.text ?? '';
  const origin = originText(version);
  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline-soft py-2 first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-baseline gap-2 text-left">
        <span className="font-mono text-[10.5px] text-muted">
          v{version.version} · {ageLabel(version.createdAt, now)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-ink">{version.summary}</span>
          {origin !== version.summary && <span className="truncate text-[11px] text-muted">{origin}</span>}
        </span>
        <span className="font-mono text-[10.5px] text-faint">{diffCounts(lineDiff(before, version.text))}</span>
      </button>
      {open && <DiffView before={before} after={version.text} />}
    </div>
  );
}

/** Every stored version, newest first, each with its diff against the one before. */
export function InstructionsVersions(props: { versions: InstructionsVersionView[] }) {
  if (props.versions.length === 0) {
    return <p className="text-xs text-faint">No versions yet.</p>;
  }
  return (
    <div className="flex flex-col">
      {props.versions.map((version, index) => (
        <VersionRow key={version.version} version={version} previous={props.versions[index + 1]} />
      ))}
    </div>
  );
}
