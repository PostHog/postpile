import { useEffect, useRef, useState } from 'react';
import type { TileView, TopicListItem } from '@postpile/core';
import { useFinishedTopics } from '../api/topics.ts';
import { moveTargets, type MoveTarget } from '../lib/move-targets.ts';
import { FilterInput } from './FilterInput.tsx';

interface MovePickerProps {
  view: TileView;
  topics: TopicListItem[];
  /** A pick: the topic and whether it came from the suggestions or a search. */
  onPick: (topicId: string, from: 'suggestion' | 'search') => void;
}

function note(target: MoveTarget): string {
  if (target.finished) {
    return 'finished';
  }
  return target.reason === 'shared_people' ? 'same people' : '';
}

/**
 * The "Move to topic…" panel inside the tile menu: a filter field over a
 * fixed-height list. `moveTargets` (lib) ranks, this only shows it. Up and
 * Down move, Enter picks; Escape is the menu's (steps back to its list).
 */
export function MovePicker(props: MovePickerProps) {
  const finished = useFinishedTopics().data ?? [];
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRow = useRef<HTMLButtonElement>(null);
  const { from, targets } = moveTargets({ tile: props.view, topics: props.topics, finished, query });
  const current = Math.min(active, targets.length - 1);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(targets.length - 1, current + step)));
    } else if (event.key === 'Enter' && targets[current]) {
      event.preventDefault();
      props.onPick(targets[current].id, from);
    }
  }

  return (
    <div className="flex w-64 flex-col gap-1">
      <FilterInput
        autoFocus
        value={query}
        onChange={(value) => {
          setQuery(value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Find a topic"
        aria-label="Find a topic to move the tile to"
      />
      <div role="listbox" className="flex h-56 flex-col overflow-auto">
        {from === 'suggestion' && targets.length > 0 && <p className="px-2.5 pt-1 pb-0.5 text-[10.5px] text-faint">Suggested</p>}
        {targets.map((target, index) => (
          <button
            key={target.id}
            ref={index === current ? activeRow : null}
            type="button"
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setActive(index)}
            onClick={() => props.onPick(target.id, from)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink-2 ${index === current ? 'bg-accent-soft text-ink' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate">{target.name}</span>
            {note(target) !== '' && <span className="shrink-0 text-[10.5px] text-faint">{note(target)}</span>}
          </button>
        ))}
        {targets.length === 0 && <p className="px-2.5 py-2 text-xs text-faint">No topic matches.</p>}
      </div>
    </div>
  );
}
