import type { SetupFitNote } from '@postpile/core';
import { FIT_CHIPS, fitFixes, fitFixLabel, type SetupFitFix, type SetupFitState } from '../lib/setup.ts';
import { Button } from './Button.tsx';
import { SetupChip } from './SetupChip.tsx';

function FitNoteRow(props: { note: SetupFitNote; onFix: (fix: SetupFitFix) => void; onKeep: () => void }) {
  const { note } = props;
  const chip = FIT_CHIPS[note.kind];
  return (
    <li className="flex flex-col gap-1 rounded-control border border-hairline bg-surface px-2.5 py-2">
      <div className="flex items-center gap-2">
        <SetupChip tone={chip.tone} word={chip.word} />
        <span className="text-[11px] text-faint">in {note.heading}</span>
      </div>
      <span className="font-mono text-[11.5px] text-ink">{note.line}</span>
      <span className="text-[11.5px] text-ink-2">{note.why}</span>
      {note.rewrite && (
        <span className="text-[11.5px] text-muted">
          Suggested: <span className="font-mono text-ink-2">{note.rewrite}</span>
        </span>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {fitFixes(note).map((fix) => (
          <Button key={fix} onClick={() => props.onFix(fix)}>
            {fitFixLabel(note, fix)}
          </Button>
        ))}
        <Button onClick={props.onKeep}>Keep as is</Button>
      </div>
    </li>
  );
}

/**
 * "Does it fit PostPile?" on the Accept step: the agent's notes on lines the
 * app cannot act on, lines under the wrong heading and vague ones, each with
 * its fix. Only suggestions: Accept stays open the whole time.
 */
export function SetupFitPanel(props: {
  fit: SetupFitState | null;
  onFix: (note: SetupFitNote, fix: SetupFitFix) => void;
  onKeep: (note: SetupFitNote) => void;
  onRetry: () => void;
}) {
  const result = props.fit?.result ?? null;
  const notes = result?.notes ?? [];
  let chip = <SetupChip tone="busy" word="Checking" />;
  if (result && !result.ok) {
    chip = <SetupChip tone="quiet" word="Not checked" />;
  } else if (result) {
    chip = notes.length === 0 ? <SetupChip tone="good" word="All lines fit" /> : <SetupChip tone="warn" word={notes.length === 1 ? '1 to look at' : `${notes.length} to look at`} />;
  }
  return (
    <section className="flex flex-col gap-2 rounded-tile border border-hairline bg-subtle p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">Does it fit PostPile?</h3>
        {chip}
      </div>
      <p className="text-[11.5px] text-muted">
        The agent checks each line against what PostPile can act on. These are suggestions: Accept saves the text as it is.
      </p>
      {result && !result.ok && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-2">{result.message}</span>
          <Button onClick={props.onRetry}>Check again</Button>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {notes.map((note) => (
            <FitNoteRow key={`${note.heading}:${note.line}`} note={note} onFix={(fix) => props.onFix(note, fix)} onKeep={() => props.onKeep(note)} />
          ))}
        </ul>
      )}
    </section>
  );
}
