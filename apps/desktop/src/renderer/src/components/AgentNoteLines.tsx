import type { PrNotesView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { agentNoteLines } from '../lib/agent-notes.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';

/**
 * "Agent note: covered by acme/app#1851 · ph3 session · 40m: …" under the
 * PR's header, muted like the "opened by" line, with Clear. A note an
 * outside agent left through note_pr; it never changes the PR's move,
 * so it stays this quiet. An out-of-date note says so up front; why, the
 * full text and a lease's end are in the tooltip, since the line truncates.
 */
export function AgentNoteLines(props: { notes: PrNotesView }) {
  const actions = useActions();
  const now = useNow();
  const lines = agentNoteLines(props.notes, now);
  if (lines.length === 0) {
    return null;
  }
  return (
    <>
      {lines.map((line) => (
        <span key={line.noteId} className="flex min-w-0 items-center gap-1 text-[11px] text-hint">
          <span className="min-w-0 truncate select-text" title={line.title}>
            Agent note{line.stale && <span> (out of date)</span>}: {line.text}
          </span>
          <Button
            variant="quiet"
            size="sm"
            className="-my-1.5"
            disabled={actions.isBusy(`clearPrNote:${line.noteId}`)}
            title="Removes the note in PostPile. Nothing changes on GitHub."
            onClick={() => void actions.clearPrNote(props.notes.prKey, line.noteId)}
          >
            Clear
          </Button>
        </span>
      ))}
    </>
  );
}
