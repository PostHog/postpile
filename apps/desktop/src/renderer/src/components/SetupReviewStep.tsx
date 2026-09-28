import { useState } from 'react';
import type { SetupCurrentInstructions, SetupDraft, SetupSectionEdit } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { draftText } from '../lib/setup.ts';
import { Button } from './Button.tsx';
import { DiffView } from './DiffView.tsx';
import { SetupRepoChoices } from './SetupRepoChoices.tsx';
import { SetupSectionCard } from './SetupSectionCard.tsx';

interface LastRefine {
  before: string;
  after: string;
  reply: string;
  changed: string[];
}

/** "Tell the agent what's off": one refine call, the change shown as a diff. */
function RefineBox(props: { edits: SetupSectionEdit[]; onRefined: (draft: SetupDraft) => void }) {
  const actions = useActions();
  const [message, setMessage] = useState('');
  const [last, setLast] = useState<LastRefine | null>(null);
  const busy = actions.isBusy('setup:refine');

  async function send() {
    const before = draftText(props.edits);
    const result = await actions.refineSetup({ sections: props.edits, message });
    if (result?.ok && result.draft) {
      setLast({ before, after: draftText(result.draft.sections), reply: result.message, changed: result.changedSections });
      setMessage('');
      props.onRefined(result.draft);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[12.5px] font-semibold text-ink">Tell the agent what's off</h3>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="min-h-16 w-full rounded-control border border-control bg-surface px-2 py-1.5 text-xs outline-none select-text focus:border-accent"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="I don't own the docs repo; I also care about release workflows…"
          aria-label="Tell the agent what's off"
        />
        <Button type="submit" variant="primary" className="self-start" disabled={busy || message.trim() === ''}>
          {busy ? 'Asking…' : 'Send to the agent'}
        </Button>
      </form>
      {last && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-ink-2">
            {last.reply}
            {last.changed.length > 0 && <span className="text-muted"> Changed: {last.changed.join(', ')}.</span>}
          </p>
          {last.before === last.after ? <p className="text-[11px] text-faint">The text did not change.</p> : <DiffView before={last.before} after={last.after} />}
        </div>
      )}
    </div>
  );
}

/**
 * Step 3: the draft as editable sections, each with "Why?", a refine chat
 * that shows its change as a diff, and the quiet repo and main repo picks.
 * On a re-run the whole draft also shows as a diff against the current file.
 */
export function SetupReviewStep(props: {
  draft: SetupDraft;
  edits: SetupSectionEdit[];
  onEdit: (index: number, body: string) => void;
  onRefined: (draft: SetupDraft) => void;
  base: SetupCurrentInstructions;
  quiet: string[];
  onQuiet: (repo: string, quiet: boolean) => void;
  mainRepo: string | null;
  onMainRepo: (repo: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [diffOpen, setDiffOpen] = useState(true);
  const text = draftText(props.edits);
  const hasCurrent = props.base.text.trim() !== '';
  return (
    <div className="grid max-w-[1080px] grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs text-ink-2">
          {props.draft.model === null ? props.draft.summary : `${props.draft.summary} Written by the agent (${props.draft.model}); edit anything, it is your text.`}
        </p>
        {hasCurrent && (
          <section className="flex flex-col gap-1.5 rounded-tile border border-accent-line bg-accent-soft p-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[12.5px] font-semibold text-ink">Compared with your current file</h3>
              {props.base.version !== null && <span className="font-mono text-[10.5px] text-faint">v{props.base.version}</span>}
              <button type="button" aria-expanded={diffOpen} onClick={() => setDiffOpen(!diffOpen)} className="ml-auto text-[11px] text-faint hover:text-ink-2 hover:underline">
                {diffOpen ? 'Hide diff' : 'Show diff'}
              </button>
            </div>
            <p className="text-[11.5px] text-muted">Accept adds a new version; the current one stays in the history.</p>
            {diffOpen && <DiffView before={props.base.text} after={text} />}
          </section>
        )}
        {props.edits.map((edit, index) => (
          <SetupSectionCard
            key={edit.heading}
            heading={edit.heading}
            body={edit.body}
            section={props.draft.sections.find((section) => section.heading === edit.heading)}
            sources={props.draft.sources}
            onChange={(body) => props.onEdit(index, body)}
          />
        ))}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button variant="primary" disabled={text.trim() === ''} title={text.trim() === '' ? 'Write at least one section first' : undefined} onClick={props.onContinue}>
            Continue
          </Button>
          <Button onClick={props.onBack}>Back to the sweep</Button>
        </div>
      </div>
      <aside className="sticky top-0 flex flex-col gap-4 rounded-tile border border-hairline bg-surface p-3.5 shadow-tile">
        <RefineBox edits={props.edits} onRefined={props.onRefined} />
        <div className="border-t border-hairline-soft pt-3">
          <SetupRepoChoices draft={props.draft} quiet={props.quiet} onQuiet={props.onQuiet} mainRepo={props.mainRepo} onMainRepo={props.onMainRepo} />
        </div>
      </aside>
    </div>
  );
}
