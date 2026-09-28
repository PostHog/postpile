// Set by the preload script in the desktop app. Absent when the renderer runs
// as a plain web page.
interface Window {
  postpile?: {
    apiUrl: string;
    token: string;
    /** "Send test notification": shown, off (POSTPILE_MAC_NOTIFICATIONS=0) or unsupported. */
    sendTestNotification?: () => Promise<'shown' | 'off' | 'unsupported'>;
    /** Trackpad swipe as back / forward; returns the unsubscribe. */
    onSwipe?: (callback: (direction: 'back' | 'forward') => void) => () => void;
    /** A click on a Mac notification: open this tile. Returns the unsubscribe. */
    onOpenPing?: (callback: (target: import('@postpile/core').PingTarget) => void) => () => void;
  };
}
