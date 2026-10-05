import { app, Notification } from 'electron';
import { ROUNDUP_TIMES, roundupTimeLabel, type InterruptionsMode, type MacNotification, type PrKey } from '@postpile/core';
import { PingShelf, type Closable } from './ping-shelf.ts';

/**
 * Notifications keep their click handler only while referenced; a GC'd
 * Notification loses the click. The newest ones are kept, older ones have
 * long left Notification Center's banner anyway.
 */
const KEEP_NOTIFICATIONS = 30;

export interface MacNotifierOptions {
  /** POSTPILE_MAC_NOTIFICATIONS=0 turns them off whatever the user picked; the poll still updates tiles. */
  enabled: boolean;
  /** Gets the notification itself: where it goes is looked up at the click, its ids may be stale by then. */
  onClick: (notification: MacNotification) => void;
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

  /** Clicked, closed or failed: no reference stays behind. */
  private forget(notification: Closable): void {
    this.shelf.remove(notification);
    const index = this.kept.findIndex((candidate) => candidate === notification);
    if (index >= 0) {
      this.kept.splice(index, 1);
    }
  }

  /** Takes the pings of PRs that are not unread anymore out of Notification Center. */
  closeRead(unreadPrKeys: PrKey[]): void {
    for (const closed of this.shelf.closeRead(unreadPrKeys, Date.now())) {
      this.forget(closed);
    }
  }

  /** The user opened the tile holding these PRs in the app: takes their pings, and only theirs, out of Notification Center. */
  closeVisited(prKeys: PrKey[]): void {
    for (const closed of this.shelf.closeVisited(prKeys, Date.now())) {
      this.forget(closed);
    }
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
        this.options.onClick(item);
      });
      notification.on('close', () => this.forget(notification));
      notification.on('failed', (_event, error) => {
        this.forget(notification);
        console.warn(`mac notifications: could not show "${item.title}": ${error}`);
      });
      this.shelf.add(item.prKeys, notification, Date.now());
      notification.show();
    }
    this.bounceForPersonal(items);
    return 'shown';
  }

  /**
   * The welcome after the user first lets PostPile interrupt them: a calm
   * notification saying what to expect, so macOS asks for the permission
   * now and not in the middle of a real ping.
   */
  showWelcome(mode: Exclude<InterruptionsMode, 'never'>): 'shown' | 'off' | 'unsupported' {
    const times = ROUNDUP_TIMES.map(roundupTimeLabel).join(', ');
    const body =
      mode === 'batches'
        ? `PostPile will send a short roundup here at ${times} on weekdays, when something needs you.`
        : 'PostPile will tap you here when someone is waiting on you.';
    return this.show([{ title: 'PostPile', body, target: null, prKeys: [], count: 1, personal: false }]);
  }

  /** "Send a test notification" from the sidebar's Interruptions menu. */
  showTest(): 'shown' | 'off' | 'unsupported' {
    return this.show([{ title: 'PostPile test notification', body: 'This is how a ping looks. Clicking one opens its tile.', target: null, prKeys: [], count: 1, personal: false }]);
  }
}
