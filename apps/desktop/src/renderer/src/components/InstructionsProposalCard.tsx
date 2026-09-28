import { useState } from 'react';
import type { InstructionsProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { Button } from './Button.tsx';
import { DiffView } from './DiffView.tsx';

function refreshNote(count: number): string {
  if (count === 0) {
    return 'Your instructions go into every prompt from the next sync on.';
  }
  return `Accepting refreshes ${count} topic ${count === 1 ? 'dossier' : 'dossiers'} once on the next sync.`;
}

/**
 * A proposed change to the user's general instructions: summary, line diff,
 * Accept / Edit / Reject. Nothing is written until Accept. When the file changed on disk meanwhile,
 * the server sends the change back rebased and the card shows that instead.
 */
export function InstructionsProposalCard(props: { proposal: InstructionsProposal; onDone: () => void }) {
  const actions = useActions();
  const [proposal, setProposal] = useState(props.proposal);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.proposal.text);
  const busy = actions.isBusy('instructions:save');

  async function accept() {
    const result = await actions.saveInstructions({ proposal, text });
    if (result?.ok) {
      props.onDone();
    } else if (result?.rebased) {
      setProposal(result.rebased);
      setText(result.rebased.text);
      setEditing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-row border border-accent-line bg-accent-soft p-3 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-ink">Change your instructions?</span>
        <span className="text-ink-2">{proposal.summary}</span>
      </div>
      {editing ? (
        <textarea
          className="min-h-40 w-full rounded-control border border-control bg-surface px-2 py-1.5 font-mono text-[11px] leading-[1.6] outline-none select-text focus:border-accent"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Proposed instructions"
        />
      ) : (
        <DiffView before={proposal.baseText} after={text} />
      )}
      <span className="text-[11.5px] text-muted">
        Applies to all topics. {refreshNote(proposal.dossiersToRefresh)}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" disabled={busy || text.trim() === ''} onClick={() => void accept()}>
          Accept
        </Button>
        <Button disabled={busy} onClick={() => setEditing(!editing)}>
          {editing ? 'Show diff' : 'Edit'}
        </Button>
        <Button disabled={busy} onClick={props.onDone}>
          Reject
        </Button>
      </div>
    </div>
  );
}
