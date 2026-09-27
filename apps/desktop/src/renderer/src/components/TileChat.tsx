import { useState } from 'react';
import type { InstructionsProposal, TailoringProposal, TileView } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { useChat } from '../api/chat.ts';
import { Button } from './Button.tsx';
import { InstructionsProposalCard } from './InstructionsProposalCard.tsx';

/**
 * Chat with the agent about a tile. A lasting point comes back as tailoring
 * for this topic ("keep it" / "just this once") or, when it applies to every
 * topic, as a change to the user's instructions. The user can switch either way.
 */
export function TileChat(props: { view: TileView; onClose: () => void }) {
  const actions = useActions();
  const tileId = props.view.tile.id;
  const chat = useChat(tileId, true);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<TailoringProposal | null>(null);
  const [instructions, setInstructions] = useState<InstructionsProposal | null>(null);
  const sending = actions.isBusy(`chat:${tileId}`);

  async function send() {
    const reply = await actions.chat(tileId, draft);
    if (reply) {
      setDraft('');
      setProposal(reply.tailoringProposal);
      setInstructions(reply.instructionsProposal);
    }
  }

  async function decide(keep: boolean) {
    if (proposal) {
      await actions.decideTailoring(proposal.topicId, proposal.text, keep);
      setProposal(null);
    }
  }

  async function applyToAllTopics() {
    if (proposal?.sourceChatMessageId) {
      const changed = await actions.proposeInstructions(proposal.sourceChatMessageId, proposal.text, proposal.topicId);
      if (changed) {
        setProposal(null);
        setInstructions(changed);
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-[22px] py-2.5">
        <span className="text-xs font-semibold">Chat about this tile</span>
        <Button className="ml-auto" onClick={props.onClose}>
          Back to PR
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-[22px] py-3">
        {chat.error && <p className="text-xs text-unread-ink">Could not load the chat: {chat.error.message}</p>}
        {chat.data?.length === 0 && <p className="text-xs text-muted">Tell the agent what matters here, or ask why the tile looks the way it does.</p>}
        {chat.data?.map((message) => (
          <p
            key={message.id}
            className={`max-w-[85%] rounded-row px-3 py-2 text-[12.5px] leading-normal select-text ${
              message.role === 'user' ? 'self-end bg-accent-soft' : 'self-start bg-subtle'
            }`}
          >
            {message.text}
          </p>
        ))}
        {proposal && (
          <div className="flex flex-col gap-2 rounded-row border border-accent-line bg-accent-soft p-3 text-xs">
            <span>
              Keep this as an instruction for the topic? <span className="font-medium">"{proposal.text}"</span>
            </span>
            <div className="flex gap-1.5">
              <Button variant="primary" onClick={() => void decide(true)}>
                Keep it
              </Button>
              <Button onClick={() => void decide(false)}>Just this once</Button>
              {proposal.sourceChatMessageId !== null && (
                <Button
                  className="ml-auto"
                  disabled={actions.isBusy('instructions:propose')}
                  title="Propose it as a change to your general instructions instead"
                  onClick={() => void applyToAllTopics()}
                >
                  Apply to all topics instead
                </Button>
              )}
            </div>
          </div>
        )}
        {instructions && (
          <InstructionsProposalCard key={instructions.sourceChatMessageId} proposal={instructions} onDone={() => setInstructions(null)} />
        )}
      </div>
      <form
        className="flex gap-1.5 border-t border-hairline px-[22px] py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="h-7 min-w-0 flex-1 rounded-control border border-control px-2 text-xs outline-none select-text focus:border-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell the agent…"
          aria-label="Message to the agent"
        />
        <Button type="submit" variant="primary" disabled={sending || draft.trim() === ''}>
          Send
        </Button>
      </form>
    </div>
  );
}
