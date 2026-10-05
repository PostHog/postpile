import type { MacNotification, Ping, PrKey } from '@postpile/core';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { MemoryPingHold, PingDelivery, StorePingHold, type PingHold } from './ping-delivery.ts';

function ping(n: number): Ping {
  return { title: `ping ${n}`, body: 'body', target: { topicId: 'topic-1', tileId: `pr:acme/app#${n}`, prKey: `acme/app#${n}` }, personal: false };
}

/** Local time; 2026-10-05 is a Monday. */
function at(hour: number, minute = 0, day = 5): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function setup(hold: PingHold = new MemoryPingHold()) {
  const shown: MacNotification[][] = [];
  const state = { unread: new Set<PrKey>(['acme/app#1', 'acme/app#2', 'acme/app#3']), macShows: true };
  const delivery = new PingDelivery({
    hold,
    unreadPrKeys: () => [...state.unread],
    onNotify: (notifications) => {
      if (state.macShows) {
        shown.push(notifications);
      }
      return state.macShows;
    },
  });
  return { delivery, shown, state };
}

describe('PingDelivery', () => {
  it('shows nothing and holds nothing under never, the default', () => {
    const { delivery, shown } = setup();
    expect(delivery.mode()).toBe('never');
    expect(delivery.deliver([ping(1)], at(10))).toBe(0);
    expect(shown).toEqual([]);
    expect(delivery.shownPrKeys()).toEqual([]);
  });

  it('shows pings right away as soon as it matters and holds them for the badge', () => {
    const { delivery, shown } = setup();
    delivery.setMode('asap');
    expect(delivery.deliver([ping(1), ping(2)], at(10))).toBe(2);
    expect(shown.flat().map((notification) => notification.title)).toEqual(['ping 1', 'ping 2']);
    expect(delivery.shownPrKeys()).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('drops a held ping once its tile is opened or its PR is not unread anymore', () => {
    const { delivery, state } = setup();
    delivery.setMode('asap');
    delivery.deliver([ping(1), ping(2), ping(3)], at(10));
    delivery.visited(['acme/app#1']);
    state.unread.delete('acme/app#2');
    expect(delivery.shownPrKeys()).toEqual(['acme/app#3']);
  });

  it('queues pings in batches and shows one roundup once its time passed', () => {
    const { delivery, shown } = setup();
    delivery.setMode('batches');
    expect(delivery.deliver([ping(1), ping(2)], at(10))).toBe(0);
    expect(delivery.roundUp(at(13, 29))).toBe(0);
    expect(delivery.shownPrKeys()).toEqual([]);

    expect(delivery.roundUp(at(13, 30))).toBe(1);
    expect(shown).toEqual([[expect.objectContaining({ title: '2 things need you', prKeys: ['acme/app#1', 'acme/app#2'] })]]);
    expect(delivery.shownPrKeys()).toEqual(['acme/app#1', 'acme/app#2']);
    expect(delivery.roundUp(at(13, 31))).toBe(0);
  });

  it('leaves what was handled before the roundup out of it', () => {
    const { delivery, shown, state } = setup();
    delivery.setMode('batches');
    delivery.deliver([ping(1), ping(2), ping(3)], at(10));
    delivery.visited(['acme/app#1']);
    state.unread.delete('acme/app#2');
    delivery.roundUp(at(14));
    expect(shown.flat().map((notification) => notification.title)).toEqual(['ping 3']);
  });

  it('keeps a ping that came after the last roundup for the next one', () => {
    const { delivery, shown } = setup();
    delivery.setMode('batches');
    delivery.deliver([ping(1)], at(17));
    expect(delivery.roundUp(at(18))).toBe(0);
    expect(delivery.roundUp(at(9, 30, 6))).toBe(1);
    expect(shown).toHaveLength(1);
  });

  it('drops the held pings when the user picks never, and the queue when leaving batches', () => {
    const { delivery } = setup();
    delivery.setMode('asap');
    delivery.deliver([ping(1)], at(10));
    delivery.setMode('batches');
    delivery.deliver([ping(2)], at(11));
    delivery.setMode('asap');
    expect(delivery.roundUp(at(14))).toBe(0);
    expect(delivery.shownPrKeys()).toEqual(['acme/app#1']);
    delivery.setMode('never');
    expect(delivery.shownPrKeys()).toEqual([]);
  });

  it('holds nothing for the badge when the Mac shows nothing (notifications off or unsupported)', () => {
    const { delivery, state } = setup();
    state.macShows = false;
    delivery.setMode('asap');
    expect(delivery.deliver([ping(1)], at(10))).toBe(0);
    expect(delivery.shownPrKeys()).toEqual([]);

    delivery.setMode('batches');
    delivery.deliver([ping(2)], at(11));
    expect(delivery.roundUp(at(13, 30))).toBe(0);
    expect(delivery.shownPrKeys()).toEqual([]);
    state.macShows = true;
    expect(delivery.roundUp(at(13, 31))).toBe(0);
  });

  it('keeps the pick and the held pings in the store', () => {
    const store = Store.open(':memory:');
    const first = setup(new StorePingHold(store));
    first.delivery.setMode('batches');
    first.delivery.deliver([ping(1)], at(10));
    const again = setup(new StorePingHold(store));
    expect(again.delivery.mode()).toBe('batches');
    expect(again.delivery.roundUp(at(13, 30))).toBe(1);
    expect(again.delivery.shownPrKeys()).toEqual(['acme/app#1']);
    store.close();
  });
});
