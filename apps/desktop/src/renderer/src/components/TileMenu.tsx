import type { TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { prNumber } from '../lib/tiles.ts';
import type { ButtonVariant } from './Button.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { MovePicker } from './MovePicker.tsx';
import { markReadNote } from '../lib/guard.ts';

interface TileMenuProps {
  view: TileView;
  topics: TopicListItem[];
  /** "Wrong topic" moves one PR: the selected one, else the tile's lead. */
  prKey: string | null;
  /** Matches the footer's other buttons (`joined` inside the tile footer's joined control). */
  variant?: ButtonVariant;
}

/** Feedback on a tile: not mine, wrong topic. */
export function TileMenu(props: TileMenuProps) {
  const actions = useActions();
  const { tile } = props.view;
  const which = props.view.prs.length > 1 && props.prKey ? `#${prNumber(props.prKey)} ` : '';

  function wrongTopic(targetTopicId: string | null, pickedFrom?: 'suggestion' | 'search') {
    void actions.feedback({ kind: 'wrong_topic', tileId: tile.id, prKey: props.prKey, targetTopicId, pickedFrom, note: '' });
  }

  // Core leaves "Not mine" out while the tile already reads Not yours (`TileOffers.notMine`); Mark read clears it then.
  const notMine: MenuItem[] = props.view.offers.notMine
    ? [
        {
          label: 'Not mine',
          title: actions.blockedReason('notMine') ?? markReadNote(actions.writes) ?? 'Clears the tile and marks the GitHub notification read after 6s',
          onSelect: () => void actions.feedback({ kind: 'not_mine', tileId: tile.id, prKey: null, targetTopicId: null, note: '' }),
        },
      ]
    : [];
  const items: MenuItem[] = [
    ...notMine,
    { label: `Wrong topic: re-sort ${which}on next sync`, onSelect: () => wrongTopic(null) },
    {
      label: `Move ${which}to topic…`,
      onSelect: () => undefined,
      panel: (close) => (
        <MovePicker
          view={props.view}
          topics={props.topics}
          onPick={(topicId, from) => {
            close();
            wrongTopic(topicId, from);
          }}
        />
      ),
    },
  ];
  // Three dots keep the tile footer room for the whose-turn line.
  const dots = (
    <span aria-hidden="true" className="flex gap-[2.5px]">
      <span className="size-[3px] rounded-full bg-muted" />
      <span className="size-[3px] rounded-full bg-muted" />
      <span className="size-[3px] rounded-full bg-muted" />
    </span>
  );
  return <Menu label={dots} title="More" items={items} align="right" size="icon" variant={props.variant} />;
}
