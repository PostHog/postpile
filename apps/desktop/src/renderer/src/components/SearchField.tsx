import { useEffect, useRef } from 'react';
import { CloseIcon, SearchIcon } from './icons.tsx';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Title bar search. It filters what is on screen, there is no result list.
 * Cmd+F focuses it from anywhere; Esc clears and leaves the field.
 */
export function SearchField(props: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <label className="flex h-7 w-full items-center gap-[7px] rounded-control bg-surface px-2.5 text-faint shadow-control inset-ring inset-ring-edge-field focus-within:inset-ring-accent-line">
      <SearchIcon />
      <input
        ref={input}
        type="search"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onChange('');
            input.current?.blur();
          }
        }}
        placeholder="Filter PRs, people, repos, branches"
        aria-label="Filter topics and tiles"
        title="Filter topics and tiles (⌘F)"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none"
      />
      {props.value !== '' && (
        <button
          type="button"
          aria-label="Clear filter"
          title="Clear filter (Esc)"
          onClick={() => {
            props.onChange('');
            input.current?.focus();
          }}
          className="flex size-4 items-center justify-center rounded-full bg-chip text-ink-2 hover:bg-hairline-strong"
        >
          <CloseIcon />
        </button>
      )}
    </label>
  );
}
