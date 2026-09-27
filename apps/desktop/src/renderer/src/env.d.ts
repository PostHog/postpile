// Set by the preload script in the desktop app. Absent when the renderer runs
// as a plain web page.
interface Window {
  codeManager?: {
    apiUrl: string;
    token: string;
    /** Trackpad swipe as back / forward; returns the unsubscribe. */
    onSwipe?: (callback: (direction: 'back' | 'forward') => void) => () => void;
  };
}
