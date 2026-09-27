import { useState } from 'react';
import type { InstructionsProposal, LastingPointProposal, TileView } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { useChat } from '../api/chat.ts';
import { Button } from './Button.tsx';
import { InstructionsProposalCard } from './InstructionsProposalCard.tsx';

/**
 * Chat with the agent about a tile. A lasting point comes back for the user
 * to place: "Keep for this topic" (tailoring), "Keep for all topics" (a
 * proposed change to their instructions, shown as a diff) or "Just this once".
 * The agent never picks the scope.
 */
export function TileChat(props: { view: TileView; initialDraft?: string; onClose: () => void }) {
  const actions = useActions();
  const tileId = props.view.tile.id;
  const chat = useChat(tileId, true);
  const [draft, setDraft] = useState(props.initialDraft ?? '');
  const [point, setPoint] = useState<LastingPointProposal | null>(null);
  const [instructions, setInstructions] = useState<InstructionsProposal | null>(null);
  const sending = actions.isBusy(`chat:${tileId}`);

  async function send() {
    const reply = await actions.chat(tileId, draft);
    if (reply) {
      setDraft('');
      setPoint(reply.lastingPoint);
      setInstructions(null);
    }
  }

  async function keepForTopic() {
    if (point?.topicId) {
      await actions.decideTailoring(point.topicId, point.text, true);
      setPoint(null);
    }
  }

  /** Logged as feedback on the topic; on Unsorted there is nothing to log it on, so it is only dismissed. */
  async function justThisOnce() {
    if (point?.topicId) {
      await actions.decideTailoring(point.topicId, point.text, false);
    }
    setPoint(null);
  }

  /** The card stays when the proposal call finds no change, so the point can still go to this topic. */
  async function keepForAllTopics() {
    if (point) {
      const proposal = await actions.proposeInstructions(point.sourceChatMessageId);
      if (proposal) {
        setPoint(null);
        setInstructions(proposal);
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
        {point && (
          <div className="flex flex-col gap-2 rounded-row border border-accent-line bg-accent-soft p-3 text-xs">
            <span>
              Keep this for later? <span className="font-medium">"{point.text}"</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="primary"
                disabled={point.topicId === null}
                title={point.topicId === null ? 'Unsorted is not a topic yet, so there is no topic to keep it on' : 'Add it to the tailoring of this topic'}
                onClick={() => void keepForTopic()}
              >
                Keep for this topic
              </Button>
              <Button
                disabled={actions.isBusy('instructions:propose')}
                title="Propose it as a change to your general instructions, shown as a diff first"
                onClick={() => void keepForAllTopics()}
              >
                Keep for all topics
              </Button>
              <Button onClick={() => void justThisOnce()}>Just this once</Button>
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
          // Opened from "Tell the agent what's wrong": the user finishes the quoted draft.
          autoFocus={Boolean(props.initialDraft)}
        />
        <Button type="submit" variant="primary" disabled={sending || draft.trim() === ''}>
          Send
        </Button>
      </form>
    </div>
  );
}
