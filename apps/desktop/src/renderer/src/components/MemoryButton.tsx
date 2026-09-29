import type { MemoryCorrection } from '@postpile/core';
import { useActions } from '../api/actions.tsx';

/** The small "Forget" link next to a "what you care about" line. Other lines get "Recheck" instead. */
export function MemoryButton(props: { correction: MemoryCorrection & { kind: 'forget' } }) {
  const actions = useActions();
  const { correction } = props;
  const busy = actions.isBusy(`correct:${correction.factId ?? correction.text}`);
  return (
    <button
      type="button"
      disabled={busy}
      title="Tell the agent you do not care about this. Stays in local memory, nothing goes to GitHub."
      onClick={() => void actions.correctMemory(correction)}
      className="shrink-0 text-[11px] text-hint hover:text-unread-ink hover:underline disabled:opacity-50"
    >
      Forget
    </button>
  );
}
