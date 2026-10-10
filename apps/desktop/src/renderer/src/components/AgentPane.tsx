import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InstructionsProposal, LastingPointProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useTopicChat } from '../api/chat.ts';
import { useAgentOffReason } from '../api/tools.ts';
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

const bubble = 'max-w-[85%] rounded-row px-3 py-2 text-[12.5px] leading-normal whitespace-pre-wrap select-text';

/**
 * What the pane holds that is not stored anywhere yet, per topic, for as
 * long as the app runs: the unsent text (also a message whose turn failed),
 * the lasting point and the instructions diff waiting for the user's pick.
 * The pane closes on Back or any pick, also while an answer or a proposal is
 * still coming; all of it is here when the topic's pane opens again.
 */
const waitingDrafts = new Map<string, string>();
const waitingPoints = new Map<string, LastingPointProposal>();
const waitingInstructions = new Map<string, InstructionsProposal>();

/**
 * The topic whose agent pane is on screen, null when none. An answer that
 * lands for another topic (the user asked, then moved on) gets a quiet
 * toast with "Open", so it does not arrive without a trace.
 */
let shownTopicId: string | null = null;

/** Keeps `value` for the topic, or drops what was kept when it is null. */
function keepFor<T>(kept: Map<string, T>, topicId: string, value: T | null): void {
  if (value) {
    kept.set(topicId, value);
  } else {
    kept.delete(topicId);
  }
}

/**
 * "Ask the agent": the topic's agent chat, in the right pane in place of the
 * PR. Private and it looks it: a grey band with a lock instead of the blue PR
 * band, and nothing here writes to GitHub. A lasting point comes back with
 * three buttons, "Keep for this topic", "Just this once" (logged as
 * `tailoring_once`) and "Keep for all topics"; a short line confirms the
 * pick. Leaving it alone also means just this once, without the log. All
 * topics shows the instructions diff first. The agent never picks the
 * scope. An answer that lands while another topic is on screen shows a
 * toast with Open (`shownTopicId`).
 *
 * A sent message shows right away with a "Thinking…" bubble under it (an
 * answer takes a few seconds), and the list keeps the newest message in
 * view. When the call fails, the bubble goes and the text is back in the
 * input; the engine stores nothing for a failed turn. The unsent text, a
 * lasting point and its instructions diff outlive the pane (`waitingDrafts`,
 * `waitingPoints`, `waitingInstructions`): leaving a point alone still means
 * just this once, but leaving the pane does not throw anything away. A new
 * turn replaces the point and the diff only once it is in.
 *
 * While the agent is off or paused (claude missing, logged out or at its
 * limit), Send and "For all topics" are disabled with the headline as their
 * tooltip, and one quiet line above the input says so. Typing still works:
 * the text waits for the agent like any unsent text.
 */
export function AgentPane(props: AgentPaneProps) {
  const actions = useActions();
  const chat = useTopicChat(props.topicId);
  // "Tell the agent" opens with its own start ("About #1907: "), kept like typed text; the header's button brings back what was left unsent.
  const [draft, setShownDraft] = useState(() => {
    if (props.draft === '') {
      return waitingDrafts.get(props.topicId) ?? '';
    }
    waitingDrafts.set(props.topicId, props.draft);
    return props.draft;
  });
  const [point, setShownPoint] = useState<LastingPointProposal | null>(() => waitingPoints.get(props.topicId) ?? null);
  const [instructions, setShownInstructions] = useState<InstructionsProposal | null>(() => waitingInstructions.get(props.topicId) ?? null);
  /** The message on its way, with how many messages the chat had when it was sent. */
  const [pending, setPending] = useState<{ text: string; count: number } | null>(null);
  /** The line after a scope pick ("Kept for Move CI to Depot."), until the next message. */
  const [picked, setPicked] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const messageCount = chat.data?.length ?? 0;
  // A turn sent before the pane was closed and opened again is still running in the provider: no second send meanwhile.
  const running = actions.isBusy(`chat:${props.topicId}`);
  const agentOff = useAgentOffReason();
  // Gone as soon as the stored chat has the turn, even before send() clears it: no doubled bubble.
  const waiting = pending !== null && pending.count === messageCount ? pending.text : null;

  useEffect(() => {
    shownTopicId = props.topicId;
    return () => {
      if (shownTopicId === props.topicId) {
        shownTopicId = null;
      }
    };
  }, [props.topicId]);

  useLayoutEffect(() => {
    const element = list.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messageCount, waiting, point, instructions, picked]);

  /** Shows the text and keeps it for the next time the pane opens. */
  function setDraft(next: string) {
    keepFor(waitingDrafts, props.topicId, next === '' ? null : next);
    setShownDraft(next);
  }

  /** Shows the point and keeps it for the next time the pane opens; null drops it. */
  function setPoint(next: LastingPointProposal | null) {
    keepFor(waitingPoints, props.topicId, next);
    setShownPoint(next);
  }

  /** The same for the instructions diff, until it is accepted or rejected. */
  function setInstructions(next: InstructionsProposal | null) {
    keepFor(waitingInstructions, props.topicId, next);
    setShownInstructions(next);
  }

  async function send() {
    const text = draft.trim();
    if (text === '' || pending !== null || running || agentOff !== null) {
      return;
    }
    setPending({ text, count: messageCount });
    setPicked(null);
    setDraft('');
    const reply = await actions.topicChat(props.topicId, text);
    setPending(null);
    if (reply && shownTopicId !== props.topicId) {
      actions.showAgentAnswered(props.topicId, props.topicName);
    }
    if (reply) {
      setPoint(reply.lastingPoint);
      setInstructions(null);
    } else if ((waitingDrafts.get(props.topicId) ?? '') === '') {
      // Back only into an empty input: text typed meanwhile, here or in a pane opened since, wins.
      setDraft(text);
    }
  }

  async function keepForTopic() {
    if (point?.topicId && (await actions.decideTailoring(point.topicId, point.text, true))) {
      setPoint(null);
      setPicked(`Kept for ${props.topicName}.`);
    }
  }

  /** Logged as said for this once; it goes into no prompt. Unsorted has no topic to log it on, so the point just goes. */
  async function justThisOnce() {
    if (!point) {
      return;
    }
    if (point.topicId === null || (await actions.decideTailoring(point.topicId, point.text, false))) {
      setPoint(null);
      setPicked('Used just this once.');
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
      <div ref={list} className="pane-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto py-4 pr-[12px] pl-[22px]">
        {chat.error && <p className="px-3 text-xs text-status-bad">Could not load the chat: {chat.error.message}</p>}
        {messageCount === 0 && waiting === null && chat.data && (
          <p className="px-3 text-xs leading-relaxed text-hint">Ask about this topic and its PRs, say what the agent got wrong, or what to keep in mind next time.</p>
        )}
        {chat.data?.map((message) => (
          <p key={message.id} className={`${bubble} ${message.role === 'user' ? 'self-end bg-accent-row' : 'self-start bg-subtle inset-ring inset-ring-hairline'}`}>
            {message.text}
          </p>
        ))}
        {waiting !== null && <p className={`${bubble} self-end bg-accent-row`}>{waiting}</p>}
        {(waiting !== null || running) && (
          <p className={`${bubble} self-start bg-subtle text-hint inset-ring inset-ring-hairline`}>
            <span className="animate-pulse">Thinking…</span>
          </p>
        )}
        {point && (
          <div className="flex flex-col gap-1.5 px-3 text-[11.5px] text-hint">
            <span>
              Remember <span className="font-medium text-ink-2">"{point.text}"</span>?
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                disabled={point.topicId === null || actions.isBusy(`tailoring:${point.topicId}`)}
                title={point.topicId === null ? 'Unsorted is not a topic yet, so there is no topic to keep it on' : 'Adds it to what this topic keeps in mind'}
                onClick={() => void keepForTopic()}
              >
                Keep for this topic
              </Button>
              <Button size="sm" disabled={point.topicId !== null && actions.isBusy(`tailoring:${point.topicId}`)} title="Used for this answer only; nothing is kept" onClick={() => void justThisOnce()}>
                Just this once
              </Button>
              <Button
                size="sm"
                disabled={actions.isBusy('instructions:propose') || agentOff !== null}
                title={agentOff ?? 'Proposes it as a change to your general instructions, shown as a diff first'}
                onClick={() => void keepForAllTopics()}
              >
                Keep for all topics
              </Button>
            </div>
          </div>
        )}
        {picked && <p className="px-3 text-[11.5px] text-hint">{picked}</p>}
        {instructions && <InstructionsProposalCard key={proposalKey(instructions)} proposal={instructions} onDone={() => setInstructions(null)} />}
      </div>
      {agentOff && <p className="shrink-0 border-t border-hairline px-[34px] pt-2.5 text-[11.5px] text-hint">{agentOff} You can still type; Send waits for the agent.</p>}
      <form
        className={`flex shrink-0 items-end gap-1.5 py-3 pr-[22px] pl-[22px] ${agentOff ? '' : 'border-t border-hairline'}`}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {/* Grows with the text up to about eight lines. Enter sends, Shift+Enter starts a new line, like most chats. */}
        <textarea
          className="field-sizing-content max-h-40 min-h-[30px] min-w-0 flex-1 resize-none rounded-control border border-control bg-surface px-2.5 py-[6px] text-[12.5px] leading-normal outline-none select-text focus:border-accent"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Ask or tell the agent…"
          aria-label="Message to the agent"
          autoFocus
        />
        <Button type="submit" variant="primary" size="md" title={agentOff ?? undefined} disabled={pending !== null || running || agentOff !== null || draft.trim() === ''}>
          Send
        </Button>
      </form>
    </aside>
  );
}
