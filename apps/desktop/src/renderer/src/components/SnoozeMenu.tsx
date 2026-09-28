import type { SnoozeCondition } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { Button, type ButtonSize } from './Button.tsx';
import { Menu } from './Menu.tsx';

function tomorrowAtNine(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

const OPTIONS: { label: string; condition: () => SnoozeCondition }[] = [
  { label: 'Until someone replies', condition: () => ({ kind: 'someone_replies' }) },
  { label: 'Until a new push', condition: () => ({ kind: 'new_push' }) },
  { label: 'Until CI is green', condition: () => ({ kind: 'ci_green' }) },
  { label: 'For 1 hour', condition: () => ({ kind: 'until_time', until: new Date(Date.now() + 3_600_000).toISOString() }) },
  { label: 'Until tomorrow 9:00', condition: () => ({ kind: 'until_time', until: tomorrowAtNine() }) },
];

/** Snooze for a tile, or Unsnooze when it is snoozed. Local only, no GitHub write. */
export function SnoozeMenu(props: { tileId: string; snoozed: boolean; size?: ButtonSize; up?: boolean }) {
  const actions = useActions();
  if (props.snoozed) {
    return (
      <Button size={props.size} onClick={() => void actions.unsnooze(props.tileId)}>
        Unsnooze
      </Button>
    );
  }
  const items = OPTIONS.map((option) => ({
    label: option.label,
    onSelect: () => void actions.snooze(props.tileId, option.condition()),
  }));
  return <Menu label="Snooze" size={props.size} up={props.up} items={items} />;
}
