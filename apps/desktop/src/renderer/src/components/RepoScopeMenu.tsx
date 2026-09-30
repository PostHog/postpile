import { useCallback, useRef, useState } from 'react';
import type { RepoEntry } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useRepos } from '../api/repos.ts';
import { countTitle, scopeLabel, shortRepo, topicCount } from '../lib/repos.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { ChevronIcon } from './icons.tsx';

const QUIET_TITLE =
  'Let it go stale: its PRs still sync and feed topic memory, but never make a topic urgent, never ping and stay out of the queue counts.';

function Radio(props: { checked: boolean }) {
  const look = props.checked ? 'border-ink' : 'border-control';
  return (
    <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border bg-surface ${look}`}>
      {props.checked && <span className="size-1.5 rounded-full bg-ink" />}
    </span>
  );
}

function Count(props: { topics: number; prs: number | null }) {
  return (
    // Words, not a bare number: a lone "6" next to a repo read as six unread things.
    <span className="shrink-0 text-[10.5px] whitespace-nowrap text-faint" title={countTitle(props.topics, props.prs)}>
      {topicCount(props.topics)}
    </span>
  );
}

function RepoRow(props: { entry: RepoEntry; busy: boolean }) {
  const actions = useActions();
  const { entry } = props;
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-subtle">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={entry.selected}
        disabled={props.busy}
        title={`Only topics with a PR in ${entry.repo}`}
        onClick={() => void actions.setRepoScope(entry.repo)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Radio checked={entry.selected} />
        <span className={`min-w-0 truncate text-xs ${entry.quiet ? 'text-muted' : 'text-ink'}`} title={entry.repo}>
          {shortRepo(entry.repo)}
        </span>
        <Count topics={entry.topics} prs={entry.prs} />
      </button>
      <button
        type="button"
        aria-pressed={entry.quiet}
        disabled={props.busy}
        title={entry.quiet ? `${entry.repo} is quiet. Click to let it count again.` : QUIET_TITLE}
        onClick={() => void actions.setRepoQuiet(entry.repo, !entry.quiet)}
        className={`shrink-0 rounded-full border px-1.5 text-[10px] leading-4 ${
          entry.quiet ? 'border-frame bg-chip text-ink-2' : 'border-transparent text-faint group-hover:border-frame hover:text-ink-2'
        }`}
      >
        {entry.quiet ? 'Quiet' : 'Let it go stale'}
      </button>
    </li>
  );
}

/**
 * Title bar repo filter: "All repos" or one repo, each with its topic
 * count, plus a per-repo "Let it go stale" switch. The chosen repo picks the
 * topics the sidebar lists (and so the queue counts and search) on the
 * server; an opened topic still shows all its tiles, labelling the ones from
 * other repos. Both choices are kept in the database.
 */
export function RepoScopeMenu() {
  const actions = useActions();
  const repos = useRepos();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  const overview = repos.data;
  const busy = actions.isBusy('repos');
  const narrowed = (overview?.scope ?? null) !== null;
  const empty = !overview || overview.repos.length === 0;
  const look = narrowed ? 'border-ink bg-ink text-on-ink' : 'border-control bg-surface text-ink-2 hover:bg-subtle';
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={empty}
        title={empty ? 'No repos yet: sync first' : 'Show the topics of one repo, or let a repo go stale'}
        onClick={() => setOpen(!open)}
        className={`flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-xs shadow-control disabled:opacity-50 ${look}`}
      >
        <span className="truncate">{scopeLabel(overview)}</span>
        <ChevronIcon />
      </button>
      {open && overview && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-1 rounded-row bg-surface p-1.5 shadow-menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!narrowed}
            disabled={busy}
            onClick={() => void actions.setRepoScope(null)}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-ink hover:bg-subtle"
          >
            <Radio checked={!narrowed} />
            <span className="min-w-0 truncate">All repos</span>
            <Count topics={overview.topics} prs={null} />
          </button>
          <ul className="flex max-h-80 flex-col overflow-auto border-t border-hairline pt-1">
            {overview.repos.map((entry) => (
              <RepoRow key={entry.repo} entry={entry} busy={busy} />
            ))}
          </ul>
          <p className="border-t border-hairline px-2 pt-1.5 pb-0.5 text-[10.5px] leading-snug text-hint">
            A repo picks the topics; an open topic still shows all its tiles. Quiet repos still sync, but never ping or make a
            topic urgent.
          </p>
        </div>
      )}
    </div>
  );
}
