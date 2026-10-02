import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PrKey, ReviewNoteKind } from '@postpile/core';
import { useActions, type Actions } from '../api/actions.tsx';
import type { GithubWrite } from '../lib/guard.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { Button, type ButtonVariant } from './Button.tsx';

/** What the popover writes: a note with the approval, a comment-only review, or "Ask <person>" (a plain PR comment). */
export type ComposeKind = ReviewNoteKind | 'ask';

interface ComposeMode {
  title: string;
  hint: string;
  submit: string;
  variant: ButtonVariant;
  write: GithubWrite;
  /** Hover text of the submit button while the write is allowed. */
  submitTitle: string;
  /** The send's busy key prefix, as `useActions` names it (`<prefix>:<prKey>`). */
  busy: string;
  /** Sends the note; true when it went out. */
  send: (actions: Actions, note: { prKey: PrKey; headOid: string; body: string }) => Promise<boolean>;
  /** Approve is optimistic (the pane shows "Approved" at once), so the popover closes on click, not after. */
  closesOnClick: boolean;
}

const MODES: Record<ComposeKind, ComposeMode> = {
  approve: {
    title: 'Approve with comment',
    hint: 'The agent drafted a short review note. Edit it, then approve.',
    submit: 'Approve with comment',
    variant: 'safe',
    write: 'approve',
    submitTitle: 'Approves on GitHub with this note. Cannot be undone.',
    busy: 'approve',
    send: async (actions, note) => {
      await actions.approve(note.prKey, note.headOid, note.body);
      return true;
    },
    closesOnClick: true,
  },
  comment: {
    title: 'Comment review',
    hint: 'A review without approval: it answers the request but does not clear the PR for merging.',
    submit: 'Post comment review',
    variant: 'primary',
    write: 'commentReview',
    submitTitle: 'Posts a comment-only review on GitHub, on the commit you see. Cannot be undone.',
    busy: 'commentReview',
    send: (actions, note) => actions.commentReview(note.prKey, note.headOid, note.body),
    closesOnClick: false,
  },
  ask: {
    title: 'Ask about this PR',
    hint: 'The agent drafts a PR comment from what you want to know. Edit it, then post.',
    submit: 'Post comment',
    variant: 'primary',
    write: 'comment',
    submitTitle: 'Posts this comment on the PR',
    busy: 'comment',
    send: (actions, note) => actions.sendComment(note.prKey, note.body),
    closesOnClick: false,
  },
};

const field = 'h-7 rounded-control border border-control bg-surface px-2 text-xs outline-none focus:border-accent select-text';

interface ComposePopoverProps {
  kind: ComposeKind;
  prKey: PrKey;
  /** The head commit on screen: approve and comment review are pinned to it. */
  headOid: string;
  /** Ask only: who to ask first, the PR's owner (`PrFacts.owners`). */
  askPerson?: string;
  onClose: () => void;
}

/**
 * The detail pane's one compose popover, under the button that opened it.
 * Approve with comment and Comment review draft on open ("Drafting…", then
 * the editable draft); Ask drafts on "Draft" from a person and an optional
 * question. Cancel closes; the primary button sends. Nothing is sent before
 * it, and an empty note cannot be sent.
 */
function ComposePopover(props: ComposePopoverProps) {
  const actions = useActions();
  const mode = MODES[props.kind];
  const [body, setBody] = useState<string | null>(null);
  const [person, setPerson] = useState(props.askPerson ?? '');
  const [intent, setIntent] = useState('');
  const drafting = actions.isBusy(`ask:${props.prKey}`);
  const sending = actions.isBusy(`${mode.busy}:${props.prKey}`);
  // StrictMode runs the effect twice on mount; one draft is enough (a ref survives that remount).
  const drafted = useRef(false);

  useEffect(() => {
    if (props.kind === 'ask' || drafted.current) {
      return;
    }
    drafted.current = true;
    // A failed draft leaves an empty note to write by hand; the toast says why.
    void actions.draftReviewNote(props.prKey, props.kind).then((text) => setBody(text ?? ''));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- drafts once per opening; actions is new every render
  }, []);

  // Under a button near the window's right edge (Ask), the popover moves left to stay inside.
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const overflow = element ? element.getBoundingClientRect().right - (window.innerWidth - 16) : 0;
    if (element && overflow > 0) {
      element.style.transform = `translateX(-${overflow}px)`;
    }
  }, []);
  // The pane scrolls; bring the whole popover into view on open and once the draft filled it.
  const filled = body !== null;
  useEffect(() => {
    dialog.current?.scrollIntoView({ block: 'nearest' });
  }, [filled]);

  async function draftAsk() {
    const text = await actions.draftAsk(props.prKey, person, intent);
    if (text !== null) {
      setBody(text);
    }
  }

  async function submit() {
    if (body === null) {
      return;
    }
    if (mode.closesOnClick) {
      props.onClose();
    }
    if (await mode.send(actions, { prKey: props.prKey, headOid: props.headOid, body })) {
      props.onClose();
    }
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-label={mode.title}
      className="absolute top-full left-0 z-20 mt-1 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-tile bg-surface p-4 shadow-menu"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-semibold text-ink">{mode.title}</h3>
        <p className="text-[11.5px] leading-snug text-muted">{mode.hint}</p>
      </div>
      {props.kind === 'ask' && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Ask</span>
          <input className={`${field} w-24`} value={person} onChange={(event) => setPerson(event.target.value)} aria-label="Person to ask" />
          <input
            className={`${field} min-w-0 flex-1`}
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="about what?"
            aria-label="What to ask"
          />
          <Button disabled={drafting || person === ''} onClick={() => void draftAsk()}>
            {drafting ? 'Drafting…' : 'Draft'}
          </Button>
        </div>
      )}
      {props.kind !== 'ask' && body === null && <p className="py-2 text-xs text-muted">Drafting…</p>}
      {body !== null && (
        <textarea
          className="min-h-24 rounded-control border border-control bg-surface p-2 text-xs leading-normal outline-none select-text focus:border-accent"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-label={`${mode.title} draft`}
          autoFocus
        />
      )}
      <div className="flex justify-end gap-1.5">
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant={mode.variant}
          disabled={sending || body === null || body.trim() === ''}
          title={actions.blockedReason(mode.write) ?? mode.submitTitle}
          onClick={() => void submit()}
        >
          {mode.submit}
        </Button>
      </div>
    </div>
  );
}

interface ComposeAnchorProps extends Omit<ComposePopoverProps, 'kind'> {
  /** The compose popover open in the pane, if any. */
  compose: ComposeKind | null;
  /** The kinds whose popover opens under these buttons. */
  kinds: ComposeKind[];
  children: ReactNode;
}

/** Buttons with the compose popover under them. A pointer down outside both, or Escape, closes it. */
export function ComposeAnchor(props: ComposeAnchorProps) {
  const root = useRef<HTMLDivElement>(null);
  const { compose, kinds, children, ...popover } = props;
  const open = compose !== null && kinds.includes(compose) ? compose : null;
  useDismiss(open !== null, props.onClose, root);
  return (
    <div ref={root} className="relative flex items-center gap-1.5">
      {children}
      {/* Keyed by kind: switching from one note to the other drafts again. */}
      {open !== null && <ComposePopover key={open} kind={open} {...popover} />}
    </div>
  );
}
