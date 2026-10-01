import { useEffect, useRef } from 'react';
import { FilterInput } from './FilterInput.tsx';

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
    <FilterInput
      ref={input}
      value={props.value}
      onChange={props.onChange}
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
      clearTitle="Clear filter (Esc)"
    />
  );
}
