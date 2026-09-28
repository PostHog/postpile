import { useState } from 'react';
import type { WorkContextThreadView, WorkContextView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useWorkContext } from '../api/work-context.ts';
import { useNow } from '../lib/use-now.ts';
import { inputLine, parseSkipText, skipNote, skipText, sourceLabel, sweepStatus } from '../lib/work-context.ts';
import { Button } from './Button.tsx';

function ThreadRow(props: { thread: WorkContextThreadView; version: number; onOpenTopic: (topicId: string) => void }) {
  const actions = useActions();
  const [whyOpen, setWhyOpen] = useState(false);
  const { thread, version } = props;
  const busy = actions.isBusy(`forget:${version}:${thread.index}`);
  return (
    <li className="group flex flex-col gap-1 border-t border-hairline-soft py-2 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold ${thread.forgotten ? 'text-faint line-through' : 'text-ink'}`}>{thread.title}</span>
        {thread.forgotten && <span className="text-[11px] text-faint">forgotten, gone after the next refresh</span>}
        <span className="ml-auto flex shrink-0 gap-2.5">
          <button
            type="button"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen(!whyOpen)}
            className="text-[11px] text-faint hover:text-ink-2 hover:underline"
          >
            Why?
          </button>
          {!thread.forgotten && (
            <button
              type="button"
              disabled={busy}
              title="Tell the agent this is not something you work on. The next refresh leaves it out. Local only."
              onClick={() => void actions.forgetWorkThread({ version, index: thread.index })}
              className="text-[11px] text-faint hover:text-unread-ink hover:underline disabled:opacity-50"
            >
              Forget
            </button>
          )}
        </span>
      </div>
      <p className={`text-xs text-ink-2 ${thread.forgotten ? 'line-through opacity-60' : ''}`}>{thread.detail}</p>
      {thread.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {thread.topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => props.onOpenTopic(topic.id)}
              className="rounded-control border border-hairline bg-subtle px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-accent-line hover:text-ink"
            >
              {topic.name}
            </button>
          ))}
        </div>
      )}
      {whyOpen && (
        <ul className="flex flex-col gap-0.5 rounded-control bg-subtle px-2 py-1.5">
          {thread.sources.length === 0 && <li className="text-[11px] text-faint">No source recorded.</li>}
          {thread.sources.map((source) => (
            <li key={`${source.kind}:${source.ref}`} className="font-mono text-[10.5px] break-all text-muted">
              {sourceLabel(source)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The skip list as one comma separated input. Saved to the user's
 * config.json, so it holds for the packaged app too (no shell env there).
 * Read-only while POSTPILE_SWEEP_SKIP overrides it.
 */
function SkipListEditor(props: { view: WorkContextView }) {
  const actions = useActions();
  const saved = skipText(props.view.skipPatterns);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const fromEnv = props.view.skipSource === 'env';
  const canSave = !fromEnv && props.view.skipConfigFile !== null && text !== saved && !actions.isBusy('workContext:skip');

  async function save() {
    if (await actions.saveSweepSkip(parseSkipText(text))) {
      setDraft(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor="sweep-skip" className="shrink-0 text-[11.5px] text-muted">
          Never read
        </label>
        <input
          id="sweep-skip"
          className="h-7 min-w-0 flex-1 rounded-control border border-control bg-surface px-2 font-mono text-[11px] text-ink outline-none select-text focus:border-accent disabled:opacity-60"
          value={text}
          disabled={fromEnv}
          placeholder="taxes, garden, side-project"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) {
              void save();
            }
          }}
        />
        <Button disabled={!canSave} onClick={() => void save()}>
          Save
        </Button>
      </div>
      <p className="text-[10.5px] text-faint">{skipNote(props.view)}</p>
    </div>
  );
}

/**
 * "What you're working on": a digest the agent writes once a day from the
 * user's local Claude Code notes. Shown below the instructions and kept
 * apart from them: the user steers it only with Forget and Refresh.
 */
export function WorkContextSection(props: { onOpenTopic: (topicId: string) => void }) {
  const actions = useActions();
  const workContext = useWorkContext();
  const now = useNow();
  const view = workContext.data;
  const current = view?.current ?? null;
  const running = (view?.running ?? false) || actions.isBusy('workContext:refresh');
  return (
    <section className="flex max-w-[680px] flex-col gap-2 rounded-tile border border-dashed border-hairline-strong bg-surface p-3.5 shadow-tile">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">What you're working on</h2>
        <span className="font-mono text-[10.5px] text-faint">agent-written{current ? ` · ${current.model}` : ''}</span>
        <Button
          className="ml-auto self-center"
          disabled={running}
          title="Read your local Claude Code notes again now. One agent call, a minute or two."
          onClick={() => void actions.refreshWorkContext()}
        >
          {running ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <p className="text-[11.5px] text-muted">
        Written by the agent once a day from your local Claude Code notes: CLAUDE.md, memory files and the first prompts of your recent sessions. Not part
        of your instructions above; other prompts get it as background that may be stale. Steer it with Forget.
      </p>
      {workContext.error && <p className="text-xs text-unread-ink">Could not load it: {workContext.error.message}</p>}
      {view?.lastError && <p className="text-xs text-unread-ink">{view.lastError.message}</p>}
      {view && !current && !running && <p className="text-xs text-faint">Nothing yet. The first one is written in the morning, or press Refresh.</p>}
      {current && (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink">{current.summary}</p>
          {current.threads.length > 0 && (
            <ul className="flex flex-col">
              {current.threads.map((thread) => (
                <ThreadRow key={thread.index} thread={thread} version={current.version} onOpenTopic={props.onOpenTopic} />
              ))}
            </ul>
          )}
          <p className="font-mono text-[10.5px] text-faint" title={current.inputStats.dropped.map((drop) => `${drop.ref}: ${drop.reason}`).join('\n')}>
            {inputLine(current.inputStats)}
          </p>
        </>
      )}
      {view && <SkipListEditor view={view} />}
      {view && <p className="text-[11px] text-muted">{sweepStatus({ ...view, running }, now)}</p>}
    </section>
  );
}
