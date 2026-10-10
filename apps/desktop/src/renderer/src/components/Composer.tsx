import type { ReviewNoteSource } from '@postpile/core';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useActions } from '../api/actions.tsx';
import { useTools } from '../api/tools.ts';
import type { GithubWrite } from '../lib/guard.ts';
import { composeKey, paneDrafts, type ComposeTarget, type PaneDrafts } from '../lib/pane-drafts.ts';
import { reviewNoteSource } from '../lib/review-note.ts';
import { Button } from './Button.tsx';

export interface ComposeState {
  open: ComposeTarget | null;
  /** The open composer came back with its PR (the user left and returned): it neither takes focus nor scrolls the pane. */
  reopened: boolean;
  /** Set by "Reply ↓" in "New since": the activity list scrolls to this comment. `seq` tells two jumps to the same comment apart. */
  jump: { commentId: string; seq: number } | null;
  openTarget(target: ComposeTarget): void;
  /** Opens the reply to a comment and asks the activity list to scroll to it. */
  jumpToReply(commentId: string): void;
  /** Only scrolls to the comment and tints it: "Reply ↓" while replies are blocked. */
  jumpToComment(commentId: string): void;
  /** Opens `target` unless a composer is open: a review note whose send failed comes back. */
  openIfClosed(target: ComposeTarget): void;
  /** Closes the composer of `key`, and only that one: a send that finishes late never closes a composer opened since. */
  close(key: string): void;
  /** The kept draft of a target, for a composer that opens again. */
  draftOf(key: string): string;
  /** Keeps a draft without re-rendering anything: the composer holds the live text itself. */
  setDraft(key: string, text: string): void;
  /** The agent's last draft for a target, null when the agent has not drafted it: tells an agent note from the user's own. */
  agentDraftOf(key: string): string | null;
  setAgentDraft(key: string, text: string | null): void;
}

const ComposeContext = createContext<ComposeState | null>(null);

export const ComposeProvider = ComposeContext.Provider;

export function useCompose(): ComposeState {
  const state = useContext(ComposeContext);
  if (!state) {
    throw new Error('useCompose needs a ComposeProvider (PrBody)');
  }
  return state;
}

/**
 * The pane's compose state for one PR. `PrBody` holds it and remounts per
 * PR; the drafts and the open composer live in `PaneDrafts` under the PR's
 * key, so they are there again when the user comes back, and a draft can
 * only ever be read by the PR it was typed for. Drafts are not React
 * state: a keystroke re-renders only the composer, never the pane with its
 * markdown and activity list.
 */
export function useComposeState(prKey: string, drafts: PaneDrafts = paneDrafts): ComposeState {
  const [open, setOpen] = useState<ComposeTarget | null>(() => drafts.openTarget(prKey));
  const [reopened, setReopened] = useState(() => drafts.openTarget(prKey) !== null);
  const [jump, setJump] = useState<{ commentId: string; seq: number } | null>(null);
  return useMemo(() => {
    function openTarget(target: ComposeTarget) {
      drafts.setOpenTarget(prKey, target);
      setReopened(false);
      setOpen(target);
    }
    function jumpTo(commentId: string) {
      setJump((current) => ({ commentId, seq: (current?.seq ?? 0) + 1 }));
    }
    return {
      open,
      reopened,
      jump,
      openTarget,
      jumpToReply: (commentId: string) => {
        openTarget({ kind: 'reply', commentId });
        jumpTo(commentId);
      },
      jumpToComment: jumpTo,
      openIfClosed: (target: ComposeTarget) => {
        if (drafts.openTarget(prKey) === null) {
          openTarget(target);
        }
      },
      close: (key: string) => {
        // Also after the pane left this PR (a send that ends late): the store forgets the open composer either way.
        const kept = drafts.openTarget(prKey);
        if (kept !== null && composeKey(kept) === key) {
          drafts.setOpenTarget(prKey, null);
        }
        setOpen((current) => (current !== null && composeKey(current) === key ? null : current));
      },
      draftOf: (key: string) => drafts.text(prKey, key),
      setDraft: (key: string, text: string) => drafts.setText(prKey, key, text),
      agentDraftOf: (key: string) => drafts.agentText(prKey, key),
      setAgentDraft: (key: string, text: string | null) => drafts.setAgentText(prKey, key, text),
    };
  }, [open, reopened, jump, prKey, drafts]);
}

interface ComposerProps {
  target: ComposeTarget;
  /** "Reply to alice", "Approve with a note". */
  title: string;
  /** Where it lands: "new PR comment, quotes their line", "on a1b2c3d, cannot be undone". */
  hint: string;
  /** The button names the target: "Post reply to alice". */
  submit: string;
  /** Green only for Approve, the colour of the state it makes. Everything else is ink. */
  variant: 'primary' | 'safe';
  write: GithubWrite;
  /** Hover text of the submit button while the write is allowed. */
  submitTitle: string;
  sending: boolean;
  drafting: boolean;
  /**
   * The agent's text: from the user's words when there are any, else from the PR alone. Null when drafting failed.
   * `quiet`: the draft on open, nobody clicked for it, so a failure shows no toast.
   */
  draft: (gist: string, quiet?: boolean) => Promise<string | null>;
  /**
   * Review notes (Approve with a note, Comment review): an empty composer asks
   * the agent for a draft as it opens, since hand-written notes are rare
   * (2026-10-06). Not while the write is blocked or the agent is known to be
   * off, and never over a kept draft. A failure stays quiet: the box stays empty.
   */
  draftsOnOpen?: boolean;
  /** True when it went out. `source`: whether the text is the agent's draft, edited, or the user's own (telemetry). */
  send: (body: string, source: ReviewNoteSource) => Promise<boolean>;
  /** Approve shows its result at once (optimistic), so its composer closes on click. The note stays when it failed. */
  closesOnClick?: boolean;
}

/** Meta or Ctrl + Enter: the send chord of Comment review, Ask and Reply. */
function isSendChord(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

/**
 * The one way to write to GitHub from the pane: opened in place under what
 * it answers, one box, the agent as a pill ("Draft with agent" on an empty
 * box, "Rewrite with agent" once there is text), Cancel, and a button that
 * names the target. Review notes start drafting on open (`draftsOnOpen`);
 * while the text is the agent's untouched draft a line under the box says
 * so. Nothing is sent before that press (or Meta/Ctrl+Enter, which presses
 * it, except for Approve with a note, which stays a deliberate click); an
 * empty text cannot be sent. Drafts stay per PR and target until sent or
 * cancelled, also across PR and topic switches.
 */
export function Composer(props: ComposerProps) {
  const actions = useActions();
  const tools = useTools();
  const compose = useCompose();
  const key = composeKey(props.target);
  const [text, setText] = useState(() => compose.draftOf(key));
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // An agent draft that comes back after Cancel or Escape is dropped, not written into the kept draft.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  function changeText(next: string) {
    setText(next);
    compose.setDraft(key, next);
  }

  function takeAgentDraft(result: string | null) {
    if (result !== null && open.current) {
      changeText(result);
      compose.setAgentDraft(key, result);
      // The pill was disabled while it drafted, which drops focus: hand it to the field, unless the user went elsewhere.
      const focused = document.activeElement;
      if (focused === null || focused === document.body || box.current?.contains(focused)) {
        field.current?.focus();
      }
    }
  }

  // Opened by a click: the field takes focus with the caret after a kept draft, and the pane brings the
  // whole composer into view. One that came back with its PR does neither: the pane opens at its top.
  useEffect(() => {
    if (compose.reopened) {
      return;
    }
    const element = field.current;
    if (element) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  // Escape and Cancel give focus back to the button that opens this composer: the one next to it that says
  // it is expanded (Reply, + note, Comment review, Ask). Found in the DOM, so it works for a reopened one too.
  function closeAndRefocus() {
    const opener = box.current?.parentElement?.querySelector<HTMLElement>('[aria-expanded="true"]') ?? null;
    compose.close(key);
    opener?.focus();
  }

  function cancel() {
    changeText('');
    compose.setAgentDraft(key, null);
    closeAndRefocus();
  }

  async function draft() {
    takeAgentDraft(await props.draft(text));
  }

  const blocked = actions.blockedReason(props.write);
  const canSend = !props.sending && !props.drafting && blocked === null && text.trim() !== '';
  const sendsOnChord = props.target.kind !== 'approve';

  async function submit() {
    const source = reviewNoteSource(text, compose.agentDraftOf(key));
    if (props.closesOnClick) {
      compose.close(key);
    }
    if (await props.send(text, source)) {
      changeText('');
      compose.setAgentDraft(key, null);
      compose.close(key);
    } else if (props.closesOnClick) {
      // It closed on click and did not go out: the note comes back, unless another composer opened meanwhile.
      compose.openIfClosed(props.target);
    }
  }

  // Once per opening, and only into an empty box: the kept draft (the user's
  // text or an earlier agent draft) wins. It waits while a draft is still out
  // (the other review note's shares the busy key) and while the write is
  // blocked or the agent is known to be off (claude missing, logged out or at
  // its limit). It fails quietly: nobody clicked, so no toast, the box stays
  // empty. The ref also keeps StrictMode's second effect run from calling twice.
  const autoDrafted = useRef(false);
  const agentOff = tools.data?.agentOn === false;
  useEffect(() => {
    if (!props.draftsOnOpen || autoDrafted.current || props.drafting || blocked !== null || agentOff || compose.draftOf(key) !== '') {
      return;
    }
    autoDrafted.current = true;
    void props.draft('', true).then(takeAgentDraft);
  });
  const untouchedAgentDraft = text !== '' && text === compose.agentDraftOf(key);
  return (
    <div
      ref={box}
      role="group"
      aria-label={props.title}
      // No frame of its own: a label, the field and the buttons, like the pane's other text boxes (Teach future assessments).
      className="flex flex-col gap-1.5"
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-[11.5px] leading-[normal]">
        <span className="shrink-0 font-medium text-ink-2">{props.title}</span>
        <span className="truncate text-hint">· {props.hint}</span>
      </div>
      {/* The agent's pill sits where the text starts, the first thing to click; the text starts under it. First in the DOM too, so Tab reaches it first. */}
      <div className="relative flex">
        <button
          type="button"
          disabled={props.drafting}
          title={text.trim() === '' ? 'The agent writes it from the PR and its topic' : 'The agent rewrites it from your words'}
          onClick={() => void draft()}
          className="absolute top-2 left-2 flex h-6 items-center gap-1 rounded-full bg-segment px-2.5 text-[11px] font-semibold text-ink-2 inset-ring inset-ring-hairline hover:bg-chip disabled:opacity-60"
        >
          <span aria-hidden="true">✨</span>
          {props.drafting ? 'Drafting…' : text.trim() === '' ? 'Draft with agent' : 'Rewrite with agent'}
        </button>
        <textarea
          ref={field}
          className="min-h-24 flex-1 rounded-control border border-control bg-surface p-2 pt-9 text-[12.5px] leading-normal outline-none select-text focus:border-accent"
          value={text}
          // Read-only, not disabled, while the agent drafts: a disabled field drops the focus it had.
          readOnly={props.drafting}
          aria-busy={props.drafting}
          placeholder={props.drafting ? 'Drafting…' : 'Or write it yourself (a gist is enough for a rewrite)'}
          onChange={(event) => changeText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closeAndRefocus();
            } else if (sendsOnChord && isSendChord(event)) {
              event.preventDefault();
              if (canSend) {
                void submit();
              }
            }
          }}
          aria-label={props.title}
        />
      </div>
      <div className="flex items-center gap-1.5">
        {untouchedAgentDraft && <span className="text-[11px] text-hint">✨ Agent draft, edit before sending</span>}
        <Button className="ml-auto" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant={props.variant}
          disabled={!canSend}
          title={blocked ?? (sendsOnChord ? `${props.submitTitle} (⌘Enter)` : props.submitTitle)}
          onClick={() => void submit()}
        >
          {props.submit}
        </Button>
      </div>
    </div>
  );
}
