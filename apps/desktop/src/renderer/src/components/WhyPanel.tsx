import type { MemoryTarget } from '@postpile/core';
import { useMemorySources } from '../api/sources.ts';
import { checkLabel, type CheckTone } from '../lib/sources.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { MemorySourceRow } from './MemorySourceRow.tsx';

const TONES: Record<CheckTone, string> = {
  ok: 'bg-safe-soft text-safe',
  warn: 'bg-closer-soft text-closer',
  muted: 'bg-segment text-muted',
};

/**
 * "Why do you think this?": the sources behind one fact or dossier line and
 * whether it still checks out. `updating`: a sync or catch-up runs for the
 * line's topic, so a stale check says "Updating now".
 */
export function WhyPanel(props: { target: MemoryTarget; updating: boolean; onClose: () => void }) {
  const now = useNow();
  const sources = useMemorySources(props.target, true);
  const data = sources.data;
  const check = data ? checkLabel(data.check, props.updating) : null;
  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-row border border-hairline bg-subtle px-3 py-2.5">
      <div className="flex items-center gap-2">
        {check && <span className={`rounded px-1.5 text-[10.5px] font-medium ${TONES[check.tone]}`}>{check.text}</span>}
        {data && (
          <span className="font-mono text-[10.5px] text-faint">
            {data.recordedIn} · {ageLabel(data.recordedAt, now)}
          </span>
        )}
        <button type="button" onClick={props.onClose} className="ml-auto text-[11px] text-faint hover:text-ink" aria-label="Close">
          Close
        </button>
      </div>
      {sources.isPending && <p className="text-xs text-muted">Looking up the sources…</p>}
      {sources.error && <p className="text-xs text-unread-ink">Could not load the sources: {sources.error.message}</p>}
      {data && data.sources.length === 0 && <p className="text-xs text-hint">No source recorded for this line.</p>}
      {data?.sources.map((source, index) => (
        <MemorySourceRow key={`${source.kind}:${source.title}:${index}`} source={source} />
      ))}
    </div>
  );
}
