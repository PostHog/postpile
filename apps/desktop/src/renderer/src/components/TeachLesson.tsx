import { useState } from 'react';
import type { PrKey, TeachLessonResult } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useLesson } from '../api/lessons.ts';
import { Button } from './Button.tsx';
import { LessonCard } from './LessonCard.tsx';

/**
 * "Teach future assessments" under the glance: the user says what it
 * should check next time, the agent makes a lesson line of it, and the
 * line waits for the same three choices as one from a review. A reply
 * without a lesson (nothing reusable, agent off, a failed call) shows as
 * text. Keyed by PR in GlanceCard, so a new PR starts closed.
 */
export function TeachLesson(props: { prKey: PrKey }) {
  const actions = useActions();
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<TeachLessonResult | null>(null);
  const busy = actions.isBusy(`teach:${props.prKey}`);
  const lesson = result?.lesson ?? null;
  // The same lesson also waits in its topic (maybe one it moved to after a sync); once decided anywhere, it is gone here too.
  const current = useLesson(lesson?.id ?? null);
  const stillOpen = lesson !== null && current.data !== null;
  // The fresh copy once loaded: after a sync moved the lesson into a topic, "Remember in this topic" works.
  const shown = current.data ?? lesson;

  async function submit() {
    const answer = await actions.teachLesson(props.prKey, note);
    if (answer) {
      setResult(answer);
      setNote('');
      setComposing(false);
    }
  }

  if (composing) {
    return (
      <form
        className="flex flex-col gap-1.5 px-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="teach-note" className="text-[11.5px] font-medium text-ink-2">
          What should it check next time?
        </label>
        <textarea
          id="teach-note"
          className="min-h-14 w-full rounded-control border border-control bg-surface px-2 py-1.5 text-xs leading-normal outline-none select-text focus:border-accent"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: Flag core imports from ee/."
          autoFocus
        />
        <div className="flex gap-1.5">
          <Button type="submit" variant="primary" disabled={busy || note.trim() === ''}>
            {busy ? 'Teaching…' : 'Teach'}
          </Button>
          <Button disabled={busy} onClick={() => setComposing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {shown && stillOpen ? (
        <>
          {result?.reply && <p className="px-3 text-[11.5px] text-ink-2">{result.reply}</p>}
          <LessonCard lesson={shown} onDecided={() => setResult(null)} />
        </>
      ) : (
        <>
          {result && !lesson && <p className="px-3 text-[11.5px] text-ink-2">{result.reply}</p>}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setComposing(true);
            }}
            className="self-start px-3 text-[11.5px] text-hint hover:text-ink hover:underline"
          >
            Teach future assessments
          </button>
        </>
      )}
    </div>
  );
}
