import type { SnoozeCondition } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { markReadNote } from '../lib/guard.ts';
import { Button, type ButtonSize, type ButtonVariant } from './Button.tsx';
import { Menu, type MenuItem } from './Menu.tsx';

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

const MUTE_TITLE =
  'Stays out of your inbox whatever others or bots do, marks it read and unsubscribes you on GitHub. Comes back when someone mentions you, asks you, replies to you or requests your review.';

const UNMUTE_TITLE = 'Shows the tile again and subscribes you to its GitHub notifications again.';

const UNSNOOZE_UNMUTES_TITLE = 'Some PRs here are muted: Unsnooze also takes their mute back and subscribes you to them on GitHub again.';

const UNMUTE_REST_TITLE =
  'Someone asked you on one PR here, so the tile is back, but the other PRs are still muted. Unmute takes their mute back and subscribes you to them on GitHub again.';

/**
 * Snooze for a tile, or Unsnooze when it is snoozed. Snoozes are local, no
 * GitHub write. The last item, "Mute until I'm mentioned", is: it marks the
 * tile read and unsubscribes on GitHub, so it is guarded like a mark-read
 * (pending while locked); a muted tile offers Unmute instead, which
 * subscribes again. `variant` primary: the pane's main button (read and
 * still your move).
 */
export function SnoozeMenu(props: {
  tileId: string;
  snoozed: boolean;
  muted?: boolean;
  /** Core's `TileState.partlyMuted`: on a snoozed tile, some PRs are muted, so Unsnooze is also an Unmute (a GitHub write). */
  partlyMuted?: boolean;
  /** Core's `TileOffers.unmuteRest`: the tile is back while some of its PRs are still muted. */
  unmuteRest?: boolean;
  size?: ButtonSize;
  up?: boolean;
  /** `right` where the button sits at a column's right edge (the tile footer), so the list opens inwards. */
  align?: 'left' | 'right';
  variant?: ButtonVariant;
}) {
  const actions = useActions();
  // Snooze and Unsnooze share the busy key: the tile shows snoozed on click, and Unsnooze waits until the server said so.
  const busy = actions.isBusy(`snooze:${props.tileId}`);
  // Never the main button; inside joined buttons it takes their look.
  const undoVariant = props.variant === 'joined' ? 'joined' : 'secondary';
  if (props.snoozed && props.muted) {
    return (
      <Button
        variant={undoVariant}
        size={props.size}
        disabled={busy}
        title={actions.blockedReason('mute') ?? markReadNote(actions.writes) ?? UNMUTE_TITLE}
        onClick={() => void actions.unsnooze(props.tileId, true)}
      >
        Unmute
      </Button>
    );
  }
  if (props.snoozed) {
    const unmutes = props.partlyMuted === true;
    const title = unmutes ? (actions.blockedReason('mute') ?? markReadNote(actions.writes) ?? UNSNOOZE_UNMUTES_TITLE) : undefined;
    return (
      <Button variant={undoVariant} size={props.size} disabled={busy} title={title} onClick={() => void actions.unsnooze(props.tileId, unmutes)}>
        Unsnooze
      </Button>
    );
  }
  const items: MenuItem[] = OPTIONS.map((option) => ({
    label: option.label,
    onSelect: () => void actions.snooze(props.tileId, option.condition()),
  }));
  items.push({
    label: "Mute until I'm mentioned",
    title: actions.blockedReason('mute') ?? [MUTE_TITLE, markReadNote(actions.writes)].filter(Boolean).join(' '),
    onSelect: () => void actions.snooze(props.tileId, { kind: 'muted' }),
  });
  if (props.unmuteRest) {
    items.push({
      label: 'Unmute the rest',
      title: actions.blockedReason('mute') ?? UNMUTE_REST_TITLE,
      onSelect: () => void actions.unsnooze(props.tileId, true),
    });
  }
  return <Menu label="Snooze" variant={props.variant} size={props.size} up={props.up} align={props.align} items={items} disabled={busy} />;
}
