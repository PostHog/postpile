import {
  DEFAULT_INTERRUPTIONS,
  interruptionsModeOf,
  latestRoundup,
  roundupNotification,
  type InterruptionsMode,
  type IsoTime,
  type MacNotification,
  type MacPingRecord,
  type Ping,
  type PrKey,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { PingThrottle } from './ping-throttle.ts';

/** Meta key of the user's pick in setup or the sidebar. */
export const INTERRUPTIONS_META_KEY = 'interruptions_mode';

/** Where the pick and the held pings live: the store in the engine, memory in the fake. */
export interface PingHold {
  mode(): InterruptionsMode;
  setMode(mode: InterruptionsMode): void;
  list(): MacPingRecord[];
  queue(ping: Ping, at: IsoTime): void;
  putShown(ping: Ping, at: IsoTime): void;
  markShown(prKeys: PrKey[], at: IsoTime): void;
  remove(prKeys: PrKey[]): void;
}

/** The pick in meta, the pings in `mac_ping`. */
export class StorePingHold implements PingHold {
  constructor(private readonly store: Store) {}

  mode(): InterruptionsMode {
    return interruptionsModeOf(this.store.meta.get(INTERRUPTIONS_META_KEY));
  }

  setMode(mode: InterruptionsMode): void {
    this.store.meta.set(INTERRUPTIONS_META_KEY, mode);
  }

  list(): MacPingRecord[] {
    return this.store.macPings.list();
  }

  queue(ping: Ping, at: IsoTime): void {
    this.store.macPings.queue(ping, at);
  }

  putShown(ping: Ping, at: IsoTime): void {
    this.store.macPings.putShown(ping, at);
  }

  markShown(prKeys: PrKey[], at: IsoTime): void {
    this.store.macPings.markShown(prKeys, at);
  }

  remove(prKeys: PrKey[]): void {
    this.store.macPings.remove(prKeys);
  }
}

/** For the sample data: the same rules, nothing kept across restarts. */
export class MemoryPingHold implements PingHold {
  private picked: InterruptionsMode = DEFAULT_INTERRUPTIONS;
  private readonly records = new Map<PrKey, MacPingRecord>();

  mode(): InterruptionsMode {
    return this.picked;
  }

  setMode(mode: InterruptionsMode): void {
    this.picked = mode;
  }

  list(): MacPingRecord[] {
    return [...this.records.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  queue(ping: Ping, at: IsoTime): void {
    this.records.set(ping.target.prKey, { ping, queuedAt: at, shownAt: null });
  }

  putShown(ping: Ping, at: IsoTime): void {
    const queuedAt = this.records.get(ping.target.prKey)?.queuedAt ?? at;
    this.records.set(ping.target.prKey, { ping, queuedAt, shownAt: at });
  }

  markShown(prKeys: PrKey[], at: IsoTime): void {
    for (const key of prKeys) {
      const record = this.records.get(key);
      if (record) {
        this.records.set(key, { ...record, shownAt: at });
      }
    }
  }

  remove(prKeys: PrKey[]): void {
    for (const key of prKeys) {
      this.records.delete(key);
    }
  }
}

function keysOf(records: MacPingRecord[]): PrKey[] {
  return records.map((record) => record.ping.target.prKey);
}

export interface PingDeliveryDeps {
  hold: PingHold;
  /** The PRs held by an unread tile now: a ping whose PR is not in it was handled. */
  unreadPrKeys: () => PrKey[];
  onNotify: (notifications: MacNotification[]) => void;
}

/**
 * Where the poll's pings go, by the user's pick (DESIGN.md "Interruptions"):
 * never drops them (the decisions are still logged), as soon as it matters
 * shows them through the throttle, in batches queues them for the next
 * roundup. Shown pings stay held for the Dock badge until handled: their
 * tile opened, or the PR read or done.
 */
export class PingDelivery {
  private readonly throttle = new PingThrottle();

  constructor(private readonly deps: PingDeliveryDeps) {}

  mode(): InterruptionsMode {
    return this.deps.hold.mode();
  }

  /** Never drops every held ping, so the Dock badge goes away; leaving batches drops the queue (those PRs are in the list anyway). */
  setMode(mode: InterruptionsMode): void {
    const { hold } = this.deps;
    hold.setMode(mode);
    if (mode === 'never') {
      hold.remove(keysOf(hold.list()));
    } else if (mode === 'asap') {
      hold.remove(keysOf(hold.list().filter((record) => record.shownAt === null)));
    }
  }

  /** Answers how many notifications went to the Mac now. */
  deliver(pings: Ping[], nowMs: number): number {
    const mode = this.mode();
    if (pings.length === 0 || mode === 'never') {
      return 0;
    }
    const at = new Date(nowMs).toISOString();
    if (mode === 'batches') {
      for (const ping of pings) {
        this.deps.hold.queue(ping, at);
      }
      return 0;
    }
    const notifications = this.throttle.plan(pings, nowMs);
    if (notifications.length === 0) {
      return 0;
    }
    const shownKeys = new Set(notifications.flatMap((notification) => notification.prKeys));
    for (const ping of pings.filter((candidate) => shownKeys.has(candidate.target.prKey))) {
      this.deps.hold.putShown(ping, at);
    }
    this.deps.onNotify(notifications);
    return notifications.length;
  }

  /** Drops the held pings whose PR is not unread anymore: read on GitHub, marked read, or done. */
  private prune(): void {
    const unread = new Set(this.deps.unreadPrKeys());
    this.deps.hold.remove(keysOf(this.deps.hold.list()).filter((key) => !unread.has(key)));
  }

  /**
   * In batches: when a roundup time passed after a queued ping came in,
   * shows one roundup for everything queued before it that is still not
   * handled. A roundup the Mac slept through goes out on wake. Answers how
   * many notifications went out (0 or 1).
   */
  roundUp(nowMs: number): number {
    if (this.mode() !== 'batches') {
      return 0;
    }
    const slot = latestRoundup(new Date(nowMs));
    if (slot === null) {
      return 0;
    }
    this.prune();
    const due = this.deps.hold.list().filter((record) => record.shownAt === null && Date.parse(record.queuedAt) < slot.getTime());
    if (due.length === 0) {
      return 0;
    }
    this.deps.hold.markShown(keysOf(due), new Date(nowMs).toISOString());
    this.deps.onNotify([roundupNotification(due.map((record) => record.ping))]);
    return 1;
  }

  /** The user opened a tile holding these PRs: their pings are handled, queued or shown. */
  visited(prKeys: PrKey[]): void {
    this.deps.hold.remove(prKeys);
  }

  /** The PRs of shown pings not handled yet, after dropping the handled ones. */
  shownPrKeys(): PrKey[] {
    this.prune();
    return keysOf(this.deps.hold.list().filter((record) => record.shownAt !== null));
  }
}
