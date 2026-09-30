import type { Tile, TileKind, Topic } from './types.ts';

/** A topic with its tiles, as the sidebar and the board show them. */
export interface TopicWithTiles {
  topic: Topic;
  tiles: Tile[];
}

export interface TileShapeEvent {
  event: 'tile_shape';
  props: { kind: TileKind; prs: number; stacked_prs: number; pulled_in: number; topic_tiles: number };
}

export interface TopicShapeEvent {
  event: 'topic_shape';
  props: { tiles: number; prs: number; single_tiles: number; stack_tiles: number; set_tiles: number };
}

export type BoardShapeEvent = TileShapeEvent | TopicShapeEvent;

function stackedPrCount(tile: Tile): number {
  if (tile.kind === 'single') {
    return 0;
  }
  return tile.stacks.reduce((sum, stack) => sum + stack.prKeys.length, 0);
}

function tileCount(tiles: Tile[], kind: TileKind): number {
  return tiles.filter((tile) => tile.kind === kind).length;
}

/**
 * The daily board shape snapshot (DESIGN.md "Usage analytics"): one
 * `tile_shape` per tile and one `topic_shape` per active topic. Counts only,
 * so the team sees how tiles and groupings turn out on real boards. Retired
 * topics are skipped.
 */
export function boardShapeEvents(board: TopicWithTiles[]): BoardShapeEvent[] {
  const events: BoardShapeEvent[] = [];
  for (const { topic, tiles } of board) {
    if (topic.status === 'retired') {
      continue;
    }
    for (const tile of tiles) {
      events.push({
        event: 'tile_shape',
        props: {
          kind: tile.kind,
          prs: tile.members.length,
          stacked_prs: stackedPrCount(tile),
          pulled_in: tile.members.filter((member) => member.provenance.kind === 'pulled_in').length,
          topic_tiles: tiles.length,
        },
      });
    }
    events.push({
      event: 'topic_shape',
      props: {
        tiles: tiles.length,
        prs: new Set(tiles.flatMap((tile) => tile.members.map((member) => member.prKey))).size,
        single_tiles: tileCount(tiles, 'single'),
        stack_tiles: tileCount(tiles, 'stack'),
        set_tiles: tileCount(tiles, 'set'),
      },
    });
  }
  return events;
}
