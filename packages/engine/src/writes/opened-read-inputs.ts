import { isTracked, prAfterMarkRead, type IsoTime, type OpenedReadInput, type PrKey, type Tile } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Board } from '../board.ts';

/**
 * What the "opened in PostPile" rule (`openedReadCheck`) reads of a PR, for
 * one Board snapshot. The server's check (`OpenedReads.markOpened`) and each
 * row's verdict (`PrSummary.openedRead`) both gather it here, so the detail
 * pane never promises a mark the server then refuses.
 */
export class OpenedReadInputs {
  /** Tiles by the PRs they hold, over every topic; built on first use. */
  private holding: Map<PrKey, Tile[]> | null = null;
  private fetchedAt: Map<PrKey, IsoTime> | null = null;

  constructor(
    private readonly board: Board,
    private readonly store: Store,
  ) {}

  private tilesHolding(prKey: PrKey): Tile[] {
    if (this.holding === null) {
      this.holding = new Map();
      for (const tile of this.board.allTiles()) {
        for (const key of new Set(tile.members.map((member) => member.prKey))) {
          const tiles = this.holding.get(key) ?? [];
          tiles.push(tile);
          this.holding.set(key, tiles);
        }
      }
    }
    return this.holding.get(prKey) ?? [];
  }

  private prFetchedAt(prKey: PrKey): IsoTime | null {
    this.fetchedAt ??= this.store.prs.fetchedAtByKey();
    return this.fetchedAt.get(prKey) ?? null;
  }

  /** A mark-read of this PR alone would leave it done (the rule behind `PrSummary.afterRead`); tracked when any tile tracks it. */
  private doneAfterRead(prKey: PrKey, tiles: Tile[]): boolean {
    const pr = this.board.prs.get(prKey);
    if (!pr) {
      return false;
    }
    const tracked = tiles.some((tile) => tile.members.some((member) => member.prKey === prKey && isTracked(member.provenance)));
    return prAfterMarkRead({
      pr,
      events: this.board.events.get(prKey) ?? [],
      userState: this.board.userStates.get(prKey) ?? null,
      viewer: this.board.viewer,
      notYours: this.board.notYours.has(prKey),
      tracked,
      readAt: this.board.now,
    }).done;
  }

  of(prKey: PrKey): OpenedReadInput {
    const tiles = this.tilesHolding(prKey);
    return {
      thread: this.board.threads.get(prKey) ?? null,
      prFetchedAt: this.prFetchedAt(prKey),
      pr: this.board.prs.get(prKey) ?? null,
      tiles: tiles.map((tile) => ({ snoozed: this.board.stateOf(tile).kind === 'snoozed' })),
      doneAfterRead: this.doneAfterRead(prKey, tiles),
    };
  }
}
