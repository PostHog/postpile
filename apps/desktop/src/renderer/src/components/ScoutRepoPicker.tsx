import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addableRepos, addRepo, addRepoBlockedReason, removeRepo, replaceRepo, unpickedRepos } from '../lib/scout-intro.ts';

interface RepoChoice {
  label: string;
  onPick: () => void;
}

/**
 * A button with a small scrolling list of repos. Its own Escape stops there,
 * so it closes the list and not the card around it.
 */
function RepoPopover(props: { button: (toggle: () => void, open: boolean) => ReactNode; choices: RepoChoice[]; footer?: RepoChoice }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const item = (choice: RepoChoice, mono: boolean) => (
    <button
      key={choice.label}
      type="button"
      role="menuitem"
      className={`rounded-md px-2.5 py-1.5 text-left text-xs whitespace-nowrap text-ink-2 hover:bg-accent-soft hover:text-ink ${mono ? 'font-mono' : ''}`}
      onClick={() => {
        setOpen(false);
        choice.onPick();
      }}
    >
      {choice.label}
    </button>
  );
  return (
    <span ref={root} className="relative">
      {props.button(() => setOpen(!open), open)}
      {open && (
        <span role="menu" className="absolute top-full left-0 z-20 mt-1 flex max-h-56 min-w-44 flex-col overflow-y-auto rounded-row bg-surface p-1 shadow-menu">
          {props.choices.map((choice) => item(choice, true))}
          {props.footer && (
            <>
              {props.choices.length > 0 && <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-hairline" />}
              {item(props.footer, false)}
            </>
          )}
        </span>
      )}
    </span>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path d="M3 4.5l3 3 3-3" fill="none" stroke="var(--hint)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Watch": the repos the scout reads, the main repo first. Each chip swaps
 * to another repo or goes; "+ repo" adds one, up to five. Rules in
 * lib/scout-intro.ts.
 */
export function ScoutRepoPicker(props: { picked: string[]; known: string[]; disabled: boolean; onChange: (repos: string[]) => void }) {
  const { picked, known, onChange } = props;
  const addBlocked = addRepoBlockedReason(picked, known);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-hint">Watch</span>
      {picked.map((repo) => (
        <RepoPopover
          key={repo}
          choices={unpickedRepos(picked, known).map((other) => ({ label: other, onPick: () => onChange(replaceRepo(picked, repo, other)) }))}
          footer={{ label: 'Stop watching it', onPick: () => onChange(removeRepo(picked, repo)) }}
          button={(toggle, open) => (
            <button
              type="button"
              aria-expanded={open}
              disabled={props.disabled}
              title={`Swap ${repo} for another repo, or stop watching it`}
              onClick={toggle}
              className="inline-flex items-center gap-1.5 rounded-row bg-surface px-[9px] py-1 font-mono text-xs text-ink inset-ring inset-ring-edge-control hover:bg-subtle disabled:opacity-50"
            >
              {repo}
              <ChevronDown />
            </button>
          )}
        />
      ))}
      <RepoPopover
        choices={addableRepos(picked, known).map((repo) => ({ label: repo, onPick: () => onChange(addRepo(picked, repo)) }))}
        button={(toggle, open) => (
          <button
            type="button"
            aria-expanded={open}
            disabled={props.disabled || addBlocked !== null}
            title={addBlocked ?? 'Watch one more repo'}
            onClick={toggle}
            className="rounded-row border border-dashed border-ghost px-[9px] py-1 text-xs text-hint hover:text-ink disabled:opacity-50 disabled:hover:text-hint"
          >
            + repo
          </button>
        )}
      />
    </div>
  );
}
