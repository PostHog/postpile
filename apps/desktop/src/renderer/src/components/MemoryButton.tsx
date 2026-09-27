import type { MemoryCorrection } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';

const TITLES = {
  wrong: 'Tell the agent this is wrong. Stays in local memory, nothing goes to GitHub.',
  forget: 'Tell the agent you do not care about this. Stays in local memory, nothing goes to GitHub.',
};

/** The small "Wrong" / "Forget" link next to a memory line. */
export function MemoryButton(props: { correction: MemoryCorrection }) {
  const actions = useActions();
  const { correction } = props;
  const busy = actions.isBusy(`correct:${correction.factId ?? correction.text}`);
  return (
    <button
      type="button"
      disabled={busy}
      title={TITLES[correction.kind]}
      onClick={() => void actions.correctMemory(correction)}
      className="shrink-0 text-[11px] text-faint hover:text-unread-ink hover:underline disabled:opacity-50"
    >
      {correction.kind === 'forget' ? 'Forget' : 'Wrong'}
    </button>
  );
}
