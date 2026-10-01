import { forwardRef, type InputHTMLAttributes } from 'react';
import { CloseIcon, SearchIcon } from './icons.tsx';

interface FilterInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className'> {
  value: string;
  onChange: (value: string) => void;
  clearTitle?: string;
}

/**
 * The search-icon text field with a clear button, shared by the title bar's
 * SearchField and the "Move to topic" picker. Keys and focus are the caller's.
 */
export const FilterInput = forwardRef<HTMLInputElement, FilterInputProps>(function FilterInput(props, ref) {
  const { value, onChange, clearTitle = 'Clear filter', ...inputProps } = props;
  return (
    <label className="flex h-7 w-full items-center gap-[7px] rounded-control bg-surface px-2.5 text-faint shadow-control inset-ring inset-ring-edge-field focus-within:inset-ring-accent-line">
      <SearchIcon />
      <input
        {...inputProps}
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear filter"
          title={clearTitle}
          onClick={() => {
            onChange('');
            if (typeof ref === 'object') {
              ref?.current?.focus();
            }
          }}
          className="flex size-4 items-center justify-center rounded-full bg-chip text-ink-2 hover:bg-hairline-strong"
        >
          <CloseIcon />
        </button>
      )}
    </label>
  );
});
