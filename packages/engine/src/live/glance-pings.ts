import {
  LOOK_CLOSER_FOLD_MS,
  lookCloserEvent,
  lookCloserFoldedBy,
  lookCloserFoldReason,
  lookCloserPingCheck,
  lookCloserPingText,
  lookCloserReason,
  type IsoTime,
  type LookCloserSeriesPr,
  type Ping,
  type PrKey,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { placeOnBoard } from './ping-target.ts';

/** Meta key: the review request a PR last pinged for through its glance. */
export function lookCloserMetaKey(prKey: PrKey): string {
  return `look_closer_ping:${prKey}`;
}

/**
 * "Routed team requests ping when the glance says Look closer" (DESIGN.md
 * "Live poll and Mac pings"). Called with the PRs whose glance was just
 * written (a full sync's digest or a catch-up run): a routed team request
 * with a LOOK_CLOSER glance pings once per request (`lookCloserPingCheck`).
 * The ping is recorded as a ping decision (source `glance`), an app-made
 * loud `look_closer` event makes the tile unread, and the ping waits here
 * until the live poller hands it to the Mac (`drain`, next poll cycle).
 *
 * One author's series pings once (`lookCloserFoldedBy`): when a PR in the
 * same topic by the same author pinged in the last hour, the request is
 * handled and the tile still gets its `look_closer` event, but no Mac ping
 * goes out, so it stays off the Dock badge. The decision is kept with ping
 * off and the fold as its reason.
 */
export class GlancePings {
  private waiting: Ping[] = [];

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /**
   * Where the PR sits now and who opened it; Unsorted counts as no topic.
   * A PR off the hot board (read since it pinged, on a busy install) falls
   * back to its stored header and topic membership.
   */
  private seriesPr(board: Board, prKey: PrKey, at: IsoTime): LookCloserSeriesPr | null {
    const onBoard = board.prs.get(prKey);
    if (onBoard) {
      const topicId = board.topicIdOf(prKey);
      return { prKey, topicId: topicId === UNSORTED_TOPIC_ID ? null : topicId, author: onBoard.author, at };
    }
    const stored = this.store.prs.get(prKey);
    if (stored === null) {
      return null;
    }
    return { prKey, topicId: this.store.memberships.get(prKey)?.topicId ?? null, author: stored.author, at };
  }

  /** The Look closer pings of the last hour, read from the ping decisions. */
  private recentPings(board: Board, at: IsoTime): LookCloserSeriesPr[] {
    const since = new Date(new Date(at).getTime() - LOOK_CLOSER_FOLD_MS).toISOString();
    const recent: LookCloserSeriesPr[] = [];
    for (const decision of this.store.pingDecisions.listGlancePingsSince(since)) {
      const seriesPr = this.seriesPr(board, decision.prKey, decision.at);
      if (seriesPr !== null) {
        recent.push(seriesPr);
      }
    }
    return recent;
  }

  afterGlances(prKeys: PrKey[]): void {
    const at = this.now().toISOString();
    const board = Board.load(this.store, at);
    const viewer = board.viewer;
    if (viewer === null) {
      return;
    }
    // Read once per batch when the first ping is due; this batch's pings are added as they go out.
    let recent: LookCloserSeriesPr[] | null = null;
    for (const key of new Set(prKeys)) {
      const pr = board.prs.get(key);
      const thread = board.threads.get(key);
      if (!pr || !thread) {
        continue;
      }
      const tiles = board.allTiles().filter((tile) => tile.members.some((member) => member.prKey === key));
      const glance = this.store.glances.get(key);
      const check = lookCloserPingCheck({
        pr,
        viewer,
        glance,
        userState: board.userStates.get(key) ?? null,
        snoozed: tiles.some((tile) => board.stateOf(tile).kind === 'snoozed'),
        pingedRequestId: this.store.meta.get(lookCloserMetaKey(key)),
      });
      if (check.kind === 'skip' || glance === null) {
        continue;
      }
      const text = lookCloserPingText(pr, check.team, glance);
      const event = lookCloserEvent(pr, check.team, check.requestId, at);
      const candidate = this.seriesPr(board, key, at);
      recent ??= this.recentPings(board, at);
      const foldedBy = candidate === null ? null : lookCloserFoldedBy(candidate, recent);
      const reason = foldedBy === null ? lookCloserReason(check.team) : lookCloserFoldReason(foldedBy, at);
      this.store.transaction(() => {
        this.store.meta.set(lookCloserMetaKey(key), check.requestId);
        if (this.store.events.addAppEvent(event)) {
          this.store.eventLog.append([{ id: event.id, prKey: key }], at);
        }
        this.store.pingDecisions.add({ threadId: thread.id, prKey: key, ping: foldedBy === null, ...text, reason, source: 'glance', at });
      });
      if (foldedBy !== null) {
        continue;
      }
      if (candidate !== null) {
        recent.push(candidate);
      }
      const place = placeOnBoard(board, key);
      this.waiting.push({ ...text, target: { topicId: place?.topicId ?? null, tileId: place?.tile?.id ?? null, prKey: key }, personal: false });
    }
  }

  /** The pings waiting for the Mac, once. */
  drain(): Ping[] {
    const pings = this.waiting;
    this.waiting = [];
    return pings;
  }
}
