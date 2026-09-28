import type { TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { prNumber } from '../lib/tiles.ts';
import { Menu, type MenuItem } from './Menu.tsx';
import { markReadNote } from '../lib/guard.ts';

interface TileMenuProps {
  view: TileView;
  topics: TopicListItem[];
  /** "Wrong topic" moves one PR: the selected one, else the tile's lead. */
  prKey: string | null;
}

/** Feedback on a tile: not mine, wrong topic. */
export function TileMenu(props: TileMenuProps) {
  const actions = useActions();
  const { tile } = props.view;
  const which = props.view.prs.length > 1 && props.prKey ? `#${prNumber(props.prKey)} ` : '';

  function wrongTopic(targetTopicId: string | null) {
    void actions.feedback({ kind: 'wrong_topic', tileId: tile.id, prKey: props.prKey, targetTopicId, note: '' });
  }

  const items: MenuItem[] = [
    {
      label: 'Not mine',
      title: actions.blockedReason('notMine') ?? markReadNote(actions.writes) ?? 'Clears the tile and marks the GitHub notification read after 6s',
      onSelect: () => void actions.feedback({ kind: 'not_mine', tileId: tile.id, prKey: null, targetTopicId: null, note: '' }),
    },
    { label: `Wrong topic: re-sort ${which}on next sync`, onSelect: () => wrongTopic(null) },
  ];
  for (const item of props.topics) {
    if (item.topic.id !== tile.topicId) {
      items.push({ label: `Move ${which}to ${item.topic.name}`, onSelect: () => wrongTopic(item.topic.id) });
    }
  }
  // A glyph label keeps the tile footer room for the whose-turn line.
  return <Menu label="⋯" title="More" items={items} align="right" />;
}
