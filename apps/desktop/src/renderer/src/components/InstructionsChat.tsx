import { useState } from 'react';
import type { InstructionsProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useInstructionsChat } from '../api/instructions.ts';
import { proposalKey } from '../lib/instructions.ts';
import { Button } from './Button.tsx';
import { InstructionsProposalCard } from './InstructionsProposalCard.tsx';

/** The general chat in "Your instructions": say what should change, get it back as a diff to accept. */
export function InstructionsChat() {
  const actions = useActions();
  const chat = useInstructionsChat();
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<InstructionsProposal | null>(null);
  const sending = actions.isBusy('instructions:chat');
  const recent = (chat.data ?? []).slice(-6);

  async function send() {
    const reply = await actions.instructionsChat(draft);
    if (reply) {
      setDraft('');
      setProposal(reply.proposal);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {chat.error && <p className="text-xs text-status-bad">Could not load the chat: {chat.error.message}</p>}
      {recent.map((message) => (
        <p
          key={message.id}
          className={`max-w-[85%] rounded-row px-3 py-1.5 text-xs leading-normal select-text ${
            message.role === 'user' ? 'self-end bg-accent-soft' : 'self-start bg-subtle text-ink-2'
          }`}
        >
          {message.text}
        </p>
      ))}
      {proposal && <InstructionsProposalCard key={proposalKey(proposal)} proposal={proposal} onDone={() => setProposal(null)} />}
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="h-7 min-w-0 flex-1 rounded-control border border-control bg-surface px-2 text-xs outline-none select-text focus:border-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="From now on…"
          aria-label="What should change in your instructions"
        />
        <Button type="submit" variant="primary" disabled={sending || draft.trim() === ''}>
          {sending ? 'Asking…' : 'Propose'}
        </Button>
      </form>
    </div>
  );
}
