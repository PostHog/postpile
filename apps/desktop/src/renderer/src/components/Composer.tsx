import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useActions } from '../api/actions.tsx';
import type { GithubWrite } from '../lib/guard.ts';
import { Button } from './Button.tsx';

/** What the pane writes to GitHub; one composer is open at a time. */
export type ComposeTarget = { kind: 'approve' } | { kind: 'comment' } | { kind: 'ask' } | { kind: 'reply'; commentId: string };

/** The draft key of a target: drafts stay per target while another one is open. */
export function composeKey(target: ComposeTarget): string {
  return target.kind === 'reply' ? `reply:${target.commentId}` : target.kind;
}

export interface ComposeState {
  open: ComposeTarget | null;
  /** Set by "Reply ↓" in "New since": the activity list scrolls to this comment. `seq` tells two jumps to the same comment apart. */
  jump: { commentId: string; seq: number } | null;
  openTarget(target: ComposeTarget): void;
  /** Opens the reply to a comment and asks the activity list to scroll to it. */
  jumpToReply(commentId: string): void;
  close(): void;
  /** The kept draft of a target, for a composer that opens again. */
  draftOf(key: string): string;
  /** Keeps a draft without re-rendering anything: the composer holds the live text itself. */
  setDraft(key: string, text: string): void;
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
 * The pane's compose state. `PrBody` holds it, so it starts fresh per PR.
 * Drafts sit in a ref, not in state: a keystroke re-renders only the
 * composer, never the pane with its markdown and activity list.
 */
export function useComposeState(): ComposeState {
  const [open, setOpen] = useState<ComposeTarget | null>(null);
  const [jump, setJump] = useState<{ commentId: string; seq: number } | null>(null);
  const drafts = useRef(new Map<string, string>());
  return useMemo(
    () => ({
      open,
      jump,
      openTarget: setOpen,
      jumpToReply: (commentId: string) => {
        setOpen({ kind: 'reply', commentId });
        setJump((current) => ({ commentId, seq: (current?.seq ?? 0) + 1 }));
      },
      close: () => setOpen(null),
      draftOf: (key: string) => drafts.current.get(key) ?? '',
      setDraft: (key: string, text: string) => drafts.current.set(key, text),
    }),
    [open, jump],
  );
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
  /** The agent's text: from the user's words when there are any, else from the PR alone. Null when drafting failed. */
  draft: (gist: string) => Promise<string | null>;
  /** True when it went out. */
  send: (body: string) => Promise<boolean>;
  /** Approve shows its result at once (optimistic), so its composer closes on click. The note stays when it failed. */
  closesOnClick?: boolean;
}

/**
 * The one way to write to GitHub from the pane: opened in place under what
 * it answers, one box, the agent as a link ("Let the agent draft" on an empty
 * box, "Rewrite with the agent" once there is text), Cancel, and a button that
 * names the target. Nothing is sent before that press; an empty text cannot
 * be sent. Drafts stay per target until sent or cancelled.
 */
export function Composer(props: ComposerProps) {
  const actions = useActions();
  const compose = useCompose();
  const key = composeKey(props.target);
  const [text, setText] = useState(() => compose.draftOf(key));
  const box = useRef<HTMLDivElement>(null);

  function changeText(next: string) {
    setText(next);
    compose.setDraft(key, next);
  }

  // The pane scrolls; bring the whole composer into view when it opens.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  function cancel() {
    changeText('');
    compose.close();
  }

  async function draft() {
    const result = await props.draft(text);
    if (result !== null) {
      changeText(result);
    }
  }

  async function submit() {
    if (props.closesOnClick) {
      compose.close();
    }
    if (await props.send(text)) {
      changeText('');
      compose.close();
    }
  }

  const blocked = actions.blockedReason(props.write);
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
      {/* The agent's pill sits where the text starts, the first thing to click; the text starts under it. */}
      <div className="relative flex">
        <textarea
          className="min-h-24 flex-1 rounded-control border border-control bg-surface p-2 pt-9 text-[12.5px] leading-normal outline-none select-text focus:border-accent"
          value={text}
          disabled={props.drafting}
          placeholder={props.drafting ? 'Drafting…' : 'Or write it yourself (a gist is enough for a rewrite)'}
          onChange={(event) => changeText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              compose.close();
            }
          }}
          aria-label={props.title}
          autoFocus
        />
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
      </div>
      <div className="flex items-center gap-1.5">
        <Button className="ml-auto" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant={props.variant}
          disabled={props.sending || props.drafting || blocked !== null || text.trim() === ''}
          title={blocked ?? props.submitTitle}
          onClick={() => void submit()}
        >
          {props.submit}
        </Button>
      </div>
    </div>
  );
}
