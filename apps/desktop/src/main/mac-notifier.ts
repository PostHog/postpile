import { app, Notification } from 'electron';
import type { MacNotification, PingTarget, PrKey } from '@postpile/core';
import { PingShelf } from './ping-shelf.ts';

/**
 * Notifications keep their click handler only while referenced; a GC'd
 * Notification loses the click. The newest ones are kept, older ones have
 * long left Notification Center's banner anyway.
 */
const KEEP_NOTIFICATIONS = 30;

export interface MacNotifierOptions {
  /** POSTPILE_MAC_NOTIFICATIONS=0 turns them off; the poll still updates tiles. */
  enabled: boolean;
  onClick: (target: PingTarget | null) => void;
  /** The Dock only bounces for a personal ask while the window is not focused. */
  isWindowFocused: () => boolean;
}

/**
 * Shows pings as native notifications (title, body, with sound). macOS asks
 * for permission on the first one. Electron cannot read that permission, so
 * a denied one only means nothing shows up: the poll, the unread tiles and
 * the footer keep working, and the failure (if Electron reports one) is logged.
 */
export class MacNotifier {
  private readonly kept: Notification[] = [];
  private readonly shelf = new PingShelf();
  private warnedUnsupported = false;

  constructor(private readonly options: MacNotifierOptions) {}

  private keep(notification: Notification): void {
    this.kept.push(notification);
    if (this.kept.length > KEEP_NOTIFICATIONS) {
      this.kept.shift();
    }
  }

  private forget(notification: Notification): void {
    const index = this.kept.indexOf(notification);
    if (index >= 0) {
      this.kept.splice(index, 1);
    }
  }

  /** Takes the pings of PRs that are not unread anymore out of Notification Center. */
  closeRead(unreadPrKeys: PrKey[]): void {
    this.shelf.closeRead(unreadPrKeys, Date.now());
  }

  /** One bounce per batch, for a personal ask, while PostPile is in the background. */
  private bounceForPersonal(items: MacNotification[]): void {
    if (items.some((item) => item.personal) && !this.options.isWindowFocused()) {
      app.dock?.bounce('informational');
    }
  }

  /** Shows the notifications; answers shown, or why not (off, unsupported). */
  show(items: MacNotification[]): 'shown' | 'off' | 'unsupported' {
    if (!this.options.enabled) {
      return 'off';
    }
    if (!Notification.isSupported()) {
      if (!this.warnedUnsupported) {
        this.warnedUnsupported = true;
        console.warn('mac notifications: not supported here, pings only show as unread tiles');
      }
      return 'unsupported';
    }
    for (const item of items) {
      const notification = new Notification({ title: item.title, body: item.body, silent: false });
      this.keep(notification);
      notification.on('click', () => {
        this.forget(notification);
        this.options.onClick(item.target);
      });
      notification.on('close', () => this.forget(notification));
      notification.on('failed', (_event, error) => {
        this.forget(notification);
        console.warn(`mac notifications: could not show "${item.title}": ${error}`);
      });
      if (item.target) {
        this.shelf.add(item.target.prKey, notification, Date.now());
      }
      notification.show();
    }
    this.bounceForPersonal(items);
    return 'shown';
  }

  /**
   * The first-launch welcome: a calm first notification, so macOS asks for
   * the permission now and not in the middle of a real ping.
   */
  showWelcome(): 'shown' | 'off' | 'unsupported' {
    return this.show([{ title: 'PostPile', body: 'PostPile will ping you here when something needs you.', target: null, count: 1, personal: false }]);
  }

  /** "Send test notification" from the status footer. */
  showTest(): 'shown' | 'off' | 'unsupported' {
    return this.show([{ title: 'PostPile test notification', body: 'This is how a ping looks. Clicking one opens its tile.', target: null, count: 1, personal: false }]);
  }
}
