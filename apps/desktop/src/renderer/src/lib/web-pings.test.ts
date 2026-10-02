import { describe, expect, it } from 'vitest';
import type { WebPing } from '@postpile/core';
import { WebPinger, type BrowserNotification, type WebPingerDeps, type WebPingPermission } from './web-pings.ts';

interface Shown extends BrowserNotification {
  title: string;
  options: NotificationOptions;
  closed: boolean;
}

function setup(permission: WebPingPermission = 'granted', answer: WebPingPermission = 'granted') {
  const shown: Shown[] = [];
  let current = permission;
  const deps: WebPingerDeps = {
    create: (title, options) => {
      const notification: Shown = {
        title,
        options,
        closed: false,
        onclick: null,
        close() {
          notification.closed = true;
        },
      };
      shown.push(notification);
      return notification;
    },
    permission: () => current,
    requestPermission: async () => {
      current = answer;
      return answer;
    },
    now: () => 1_000,
  };
  return { pinger: new WebPinger(deps), shown };
}

function ping(id: number, prKey: string): WebPing {
  return { id, notification: { title: `ping ${id}`, body: 'rowan asked you', target: { topicId: 't', tileId: null, prKey }, prKeys: [prKey], count: 1, personal: true } };
}

describe('WebPinger', () => {
  it('shows each ping once, even when the same feed answer comes twice', () => {
    const { pinger, shown } = setup();
    expect(pinger.show([ping(1, 'acme/app#1'), ping(2, 'acme/app#2')], () => {})).toBe(2);
    expect(pinger.show([ping(2, 'acme/app#2')], () => {})).toBe(0);
    expect(shown.map((item) => [item.title, item.options.tag])).toEqual([
      ['ping 1', 'postpile-ping-1'],
      ['ping 2', 'postpile-ping-2'],
    ]);
  });

  it('shows nothing without the permission, and never asks for it on its own', () => {
    const { pinger, shown } = setup('default');
    expect(pinger.show([ping(1, 'acme/app#1')], () => {})).toBe(0);
    expect(shown).toEqual([]);
  });

  it('closes the clicked ping and hands it over', () => {
    const { pinger, shown } = setup();
    const clicked: number[] = [];
    pinger.show([ping(5, 'acme/app#5')], (item) => clicked.push(item.id));
    shown[0]!.onclick?.(new Event('click'));
    expect(clicked).toEqual([5]);
    expect(shown[0]!.closed).toBe(true);
  });

  it('takes back the pings of a tile the user opened, and only those', () => {
    const { pinger, shown } = setup();
    pinger.show([ping(1, 'acme/app#1'), ping(2, 'acme/app#2')], () => {});
    pinger.closeVisited(['acme/app#2']);
    expect(shown.map((item) => item.closed)).toEqual([false, true]);
  });

  it('asks for the permission on the test ping, then shows it or says why not', async () => {
    const allowed = setup('default', 'granted');
    expect(await allowed.pinger.showTest()).toBe('shown');
    expect(allowed.shown.map((item) => item.title)).toEqual(['PostPile test notification']);
    const refused = setup('default', 'denied');
    expect(await refused.pinger.showTest()).toBe('denied');
    expect(refused.shown).toEqual([]);
    expect(await setup('denied').pinger.showTest()).toBe('denied');
  });

  it('says unsupported when the browser has no notifications', async () => {
    const pinger = new WebPinger({ create: null, permission: () => 'unsupported', requestPermission: async () => 'unsupported', now: () => 0 });
    expect(await pinger.showTest()).toBe('unsupported');
    expect(pinger.show([ping(1, 'acme/app#1')], () => {})).toBe(0);
  });
});
