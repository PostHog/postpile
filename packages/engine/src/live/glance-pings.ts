import { lookCloserEvent, lookCloserPingCheck, lookCloserPingText, lookCloserReason, type Ping, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';

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
 */
export class GlancePings {
  private waiting: Ping[] = [];

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  afterGlances(prKeys: PrKey[]): void {
    const at = this.now().toISOString();
    const board = Board.load(this.store, at);
    const viewer = board.viewer;
    if (viewer === null) {
      return;
    }
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
      this.store.transaction(() => {
        this.store.meta.set(lookCloserMetaKey(key), check.requestId);
        if (this.store.events.addAppEvent(event)) {
          this.store.eventLog.append([{ id: event.id, prKey: key }], at);
        }
        this.store.pingDecisions.add({ threadId: thread.id, prKey: key, ping: true, ...text, reason: lookCloserReason(check.team), source: 'glance', at });
      });
      const topicId = board.topicIdOf(key);
      const tile = topicId ? board.tilesForTopic(topicId).find((candidate) => candidate.members.some((member) => member.prKey === key)) : undefined;
      this.waiting.push({ ...text, target: { topicId, tileId: tile?.id ?? null, prKey: key } });
    }
  }

  /** The pings waiting for the Mac, once. */
  drain(): Ping[] {
    const pings = this.waiting;
    this.waiting = [];
    return pings;
  }
}
