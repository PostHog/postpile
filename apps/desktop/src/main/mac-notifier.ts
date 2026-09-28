import { Notification } from 'electron';
import type { MacNotification, PingTarget } from '@postpile/core';

/**
 * Notifications keep their click handler only while referenced; a GC'd
 * Notification loses the click. The newest ones are kept, older ones have
 * long left Notification Center's banner anyway.
 */
const KEEP_NOTIFICATIONS = 30;

export interface MacNotifierOptions {
  /** CODE_MANAGER_MAC_NOTIFICATIONS=0 turns them off; the poll still updates tiles. */
  enabled: boolean;
  onClick: (target: PingTarget | null) => void;
}

/**
 * Shows pings as native notifications (title, body, with sound). macOS asks
 * for permission on the first one. Electron cannot read that permission, so
 * a denied one only means nothing shows up: the poll, the unread tiles and
 * the footer keep working, and the failure (if Electron reports one) is logged.
 */
export class MacNotifier {
  private readonly kept: Notification[] = [];
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

  show(items: MacNotification[]): void {
    if (!this.options.enabled) {
      return;
    }
    if (!Notification.isSupported()) {
      if (!this.warnedUnsupported) {
        this.warnedUnsupported = true;
        console.warn('mac notifications: not supported here, pings only show as unread tiles');
      }
      return;
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
      notification.show();
    }
  }
}
