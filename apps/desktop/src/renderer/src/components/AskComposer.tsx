import { useState } from 'react';
import { useActions } from '../api/actions.tsx';
import { Button } from './Button.tsx';

interface AskComposerProps {
  prKey: string;
  author: string;
  onClose: () => void;
}

const input = 'h-7 rounded-control border border-control bg-surface px-2 text-xs outline-none focus:border-accent select-text';

/** "Ask <person>": the agent drafts a PR comment, the user edits it and sends it. */
export function AskComposer(props: AskComposerProps) {
  const actions = useActions();
  const [person, setPerson] = useState(props.author);
  const [intent, setIntent] = useState('');
  const [body, setBody] = useState<string | null>(null);
  const drafting = actions.isBusy(`ask:${props.prKey}`);
  const sending = actions.isBusy(`comment:${props.prKey}`);

  async function draft() {
    const text = await actions.draftAsk(props.prKey, person, intent);
    if (text !== null) {
      setBody(text);
    }
  }

  async function send() {
    if (body && (await actions.sendComment(props.prKey, body))) {
      props.onClose();
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-hairline bg-actionbar px-[22px] py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted">Ask</span>
        <input className={`${input} w-24`} value={person} onChange={(event) => setPerson(event.target.value)} aria-label="Person to ask" />
        <input
          className={`${input} min-w-0 flex-1`}
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="about what?"
          aria-label="What to ask"
        />
        <Button disabled={drafting || person === ''} onClick={() => void draft()}>
          {drafting ? 'Drafting…' : 'Draft'}
        </Button>
        <Button onClick={props.onClose}>Cancel</Button>
      </div>
      {body !== null && (
        <>
          <textarea
            className="min-h-24 rounded-control border border-control bg-surface p-2 text-xs leading-normal outline-none select-text focus:border-accent"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label="Comment draft"
          />
          <div className="flex gap-1.5">
            <Button
              variant="primary"
              disabled={sending || body.trim() === ''}
              title={actions.blockedReason('comment') ?? 'Posts this comment on the PR'}
              onClick={() => void send()}
            >
              Send comment
            </Button>
            <Button onClick={() => setBody(null)}>Discard</Button>
          </div>
        </>
      )}
    </div>
  );
}
