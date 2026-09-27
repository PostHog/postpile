import { lineDiff, withContext } from '../lib/diff.ts';

const LINE_TONES = {
  same: 'text-muted',
  added: 'bg-diff-add text-diff-add-ink',
  removed: 'bg-diff-del text-diff-del-ink line-through decoration-diff-del-ink/40',
};

const MARKS = { same: ' ', added: '+', removed: '−' };

/** A line diff from `before` to `after`, unchanged runs folded away beyond `context` lines. */
export function DiffView(props: { before: string; after: string; context?: number }) {
  const rows = withContext(lineDiff(props.before, props.after), props.context ?? 2);
  return (
    <div className="overflow-auto rounded-row border border-hairline bg-surface py-1 font-mono text-[11px] leading-[1.6] select-text">
      {rows.map((row, index) =>
        row.kind === 'gap' ? (
          <div key={index} className="px-2.5 text-faint">
            ⋯ {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
          </div>
        ) : (
          <div key={index} className={`flex gap-2 px-2.5 whitespace-pre-wrap ${LINE_TONES[row.kind]}`}>
            <span className="w-2 shrink-0 select-none">{MARKS[row.kind]}</span>
            <span className="min-w-0">{row.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}
