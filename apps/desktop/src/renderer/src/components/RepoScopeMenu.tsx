import { useCallback, useRef, useState } from 'react';
import type { RepoEntry, RepoOverview } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useRepos } from '../api/repos.ts';
import { scopeLabel, shortRepo, toggledScope } from '../lib/repos.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { CheckIcon, ChevronIcon } from './icons.tsx';

const QUIET_TITLE =
  'Let it go stale: its PRs still sync and feed topic memory, but never make a topic urgent, never ping and stay out of the queue counts.';

function CheckBox(props: { checked: boolean }) {
  const look = props.checked ? 'border-ink bg-ink text-on-ink' : 'border-control bg-surface text-transparent';
  return <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${look}`}>{props.checked && <CheckIcon />}</span>;
}

function RepoRow(props: { entry: RepoEntry; overview: RepoOverview; busy: boolean }) {
  const actions = useActions();
  const { entry } = props;
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-subtle">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={entry.inScope}
        disabled={props.busy}
        title={entry.inScope ? `Hide ${entry.repo}` : `Show ${entry.repo}`}
        onClick={() => void actions.setRepoScope(toggledScope(props.overview, entry.repo))}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <CheckBox checked={entry.inScope} />
        <span className={`min-w-0 truncate text-xs ${entry.quiet ? 'text-muted' : 'text-ink'}`} title={entry.repo}>
          {shortRepo(entry.repo)}
        </span>
        <span className="font-mono text-[10.5px] text-faint">{entry.prs}</span>
      </button>
      <button
        type="button"
        disabled={props.busy}
        title={`Show only ${entry.repo}`}
        onClick={() => void actions.setRepoScope([entry.repo])}
        className="hidden text-[10.5px] text-muted group-hover:block hover:text-ink"
      >
        Only
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
 * Title bar repo filter: "All repos" or some of them, each with its PR
 * count, plus a per-repo "Let it go stale" switch. The scope narrows the
 * sidebar, queues and tiles on the server, so it combines with the search
 * and the queue filters. Both choices are kept in the database.
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
        title={empty ? 'No repos yet: sync first' : 'Show some repos only, or let a repo go stale'}
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
            <CheckBox checked={!narrowed} />
            All repos
          </button>
          <ul className="flex max-h-80 flex-col overflow-auto border-t border-hairline pt-1">
            {overview.repos.map((entry) => (
              <RepoRow key={entry.repo} entry={entry} overview={overview} busy={busy} />
            ))}
          </ul>
          <p className="border-t border-hairline px-2 pt-1.5 pb-0.5 text-[10.5px] leading-snug text-faint">
            Quiet repos still sync, but never ping or make a topic urgent.
          </p>
        </div>
      )}
    </div>
  );
}
