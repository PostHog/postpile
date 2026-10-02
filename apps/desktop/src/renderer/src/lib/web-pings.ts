import { PingShelf, type PrKey, type WebPing } from '@postpile/core';

export type WebPingPermission = NotificationPermission | 'unsupported';

export type WebPingTestResult = 'shown' | 'denied' | 'unsupported';

export interface BrowserNotification {
  close(): void;
  onclick: ((event: Event) => void) | null;
}

export interface WebPingerDeps {
  create: ((title: string, options: NotificationOptions) => BrowserNotification) | null;
  permission: () => WebPingPermission;
  requestPermission: () => Promise<WebPingPermission>;
  now: () => number;
}

export class WebPinger {
  private readonly shelf = new PingShelf();
  private readonly shown = new Set<number>();

  constructor(private readonly deps: WebPingerDeps) {}

  show(pings: WebPing[], onClick: (ping: WebPing) => void): number {
    const create = this.deps.create;
    if (!create || this.deps.permission() !== 'granted') {
      return 0;
    }
    let count = 0;
    for (const ping of pings) {
      if (this.shown.has(ping.id)) {
        continue;
      }
      this.shown.add(ping.id);
      const notification = create(ping.notification.title, { body: ping.notification.body, tag: `postpile-ping-${ping.id}` });
      notification.onclick = () => {
        notification.close();
        this.shelf.remove(notification);
        onClick(ping);
      };
      this.shelf.add(ping.notification.prKeys, notification, this.deps.now());
      count += 1;
    }
    return count;
  }

  closeVisited(prKeys: PrKey[]): void {
    this.shelf.closeVisited(prKeys, this.deps.now());
  }

  async showTest(): Promise<WebPingTestResult> {
    const create = this.deps.create;
    if (!create) {
      return 'unsupported';
    }
    const permission = this.deps.permission() === 'default' ? await this.deps.requestPermission() : this.deps.permission();
    if (permission !== 'granted') {
      return 'denied';
    }
    create('PostPile test notification', { body: 'This is how a ping looks. Clicking one opens its tile.', tag: 'postpile-test' });
    return 'shown';
  }
}

export function browserPermission(): WebPingPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function browserDeps(): WebPingerDeps {
  if (typeof Notification === 'undefined') {
    return { create: null, permission: () => 'unsupported', requestPermission: async () => 'unsupported', now: () => Date.now() };
  }
  return {
    create: (title, options) => new Notification(title, options),
    permission: browserPermission,
    requestPermission: () => Notification.requestPermission(),
    now: () => Date.now(),
  };
}

export const webPinger = new WebPinger(browserDeps());

export function isWebPage(): boolean {
  return window.postpile === undefined;
}
