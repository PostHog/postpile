import { useState } from 'react';
import type { InstructionsProposal, LastingPointProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useTopicChat } from '../api/chat.ts';
import { proposalKey } from '../lib/instructions.ts';
import { Button } from './Button.tsx';
import { LockIcon } from './icons.tsx';
import { InstructionsProposalCard } from './InstructionsProposalCard.tsx';

interface AgentPaneProps {
  topicId: string;
  topicName: string;
  /** What the input starts with: "About #1907: " from "Tell the agent", empty from the topic header. */
  draft: string;
  /** "Back to #1907": the PR that was open. */
  backLabel: string;
  onBack: () => void;
}

const linkButton = 'text-[11.5px] font-semibold text-accent hover:underline disabled:text-hint disabled:no-underline';

/**
 * "Ask the agent": the topic's agent chat, in the right pane in place of the
 * PR. Private and it looks it: a grey band with a lock instead of the blue PR
 * band, and nothing here writes to GitHub. A lasting point comes back as one
 * line, "For this topic · For all topics"; leaving it alone means just this
 * once. All topics shows the instructions diff first. The agent never picks
 * the scope.
 */
export function AgentPane(props: AgentPaneProps) {
  const actions = useActions();
  const chat = useTopicChat(props.topicId, true);
  const [draft, setDraft] = useState(props.draft);
  const [point, setPoint] = useState<LastingPointProposal | null>(null);
  const [instructions, setInstructions] = useState<InstructionsProposal | null>(null);
  const sending = actions.isBusy(`chat:${props.topicId}`);

  async function send() {
    const reply = await actions.topicChat(props.topicId, draft);
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

  /** The line stays when the proposal call finds no change, so the point can still go to this topic. */
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
    <aside aria-label="Agent" className="flex min-h-0 flex-col bg-surface shadow-[inset_1px_0_0_var(--hairline-strong)]">
      <div className="flex shrink-0 flex-col gap-1 bg-subtle px-[22px] pt-3.5 pb-3 shadow-[inset_0_-1px_0_var(--hairline),inset_1px_0_0_var(--hairline-strong)]">
        <div className="flex min-w-0 items-center gap-2 px-3">
          <span className="shrink-0 text-ink-2">
            <LockIcon size={13} />
          </span>
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">Agent · {props.topicName}</span>
          <Button className="ml-auto" size="sm" onClick={props.onBack}>
            ‹ {props.backLabel}
          </Button>
        </div>
        <span className="px-3 text-[11px] text-hint">Only you see this. Nothing here goes to GitHub.</span>
      </div>
      <div className="pane-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto py-4 pr-[12px] pl-[22px]">
        {chat.error && <p className="px-3 text-xs text-status-bad">Could not load the chat: {chat.error.message}</p>}
        {chat.data?.length === 0 && (
          <p className="px-3 text-xs leading-relaxed text-hint">Ask about this topic and its PRs, say what the agent got wrong, or what to keep in mind next time.</p>
        )}
        {chat.data?.map((message) => (
          <p
            key={message.id}
            className={`max-w-[85%] rounded-row px-3 py-2 text-[12.5px] leading-normal whitespace-pre-wrap select-text ${
              message.role === 'user' ? 'self-end bg-accent-row' : 'self-start bg-subtle inset-ring inset-ring-hairline'
            }`}
          >
            {message.text}
          </p>
        ))}
        {point && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 text-[11.5px] text-hint">
            <span>
              Remember <span className="font-medium text-ink-2">"{point.text}"</span>?
            </span>
            <button
              type="button"
              className={linkButton}
              disabled={point.topicId === null}
              title={point.topicId === null ? 'Unsorted is not a topic yet, so there is no topic to keep it on' : 'Adds it to what this topic remembers'}
              onClick={() => void keepForTopic()}
            >
              For this topic
            </button>
            <span className="text-faint">·</span>
            <button
              type="button"
              className={linkButton}
              disabled={actions.isBusy('instructions:propose')}
              title="Proposes it as a change to your general instructions, shown as a diff first"
              onClick={() => void keepForAllTopics()}
            >
              For all topics
            </button>
          </div>
        )}
        {instructions && <InstructionsProposalCard key={proposalKey(instructions)} proposal={instructions} onDone={() => setInstructions(null)} />}
      </div>
      <form
        className="flex shrink-0 gap-1.5 border-t border-hairline py-3 pr-[22px] pl-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="h-[30px] min-w-0 flex-1 rounded-control border border-control px-2.5 text-[12.5px] outline-none select-text focus:border-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell the agent…"
          aria-label="Message to the agent"
          autoFocus
        />
        <Button type="submit" variant="primary" size="md" disabled={sending || draft.trim() === ''}>
          {sending ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </aside>
  );
}
