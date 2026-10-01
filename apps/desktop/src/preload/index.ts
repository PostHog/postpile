// Runs sandboxed before the renderer. It hands over where the API lives, the app version, two
// listeners (trackpad swipes, clicks on Mac notifications) and two calls (the
// test notification, the tile the user visited), nothing else: no node access, no other ipc. The API URL
// and token come from the main process over one sync ipc call (it answers
// only the app's own page); the version comes as a command line argument.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PingTarget } from '@postpile/core';

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

const connection = (ipcRenderer.sendSync('postpile:connection') as { apiUrl: string; token: string } | null) ?? { apiUrl: '', token: '' };

contextBridge.exposeInMainWorld('postpile', {
  apiUrl: connection.apiUrl,
  token: connection.token,
  /** The app version, e.g. 0.1.0-alpha.0, for the status footer. */
  version: argValue('postpile-version'),
  /** Shows a test Mac notification; answers shown, off (POSTPILE_MAC_NOTIFICATIONS=0) or unsupported. */
  sendTestNotification(): Promise<'shown' | 'off' | 'unsupported'> {
    return ipcRenderer.invoke('postpile:test-notification') as Promise<'shown' | 'off' | 'unsupported'>;
  },
  /** The PRs of the tile the user opened, so their Mac pings leave Notification Center; main does the matching. */
  tileVisited(prKeys: string[]): void {
    ipcRenderer.send('postpile:tile-visited', prKeys);
  },
  /** Calls back with "back" or "forward" on a trackpad swipe; returns the unsubscribe. */
  onSwipe(callback: (direction: 'back' | 'forward') => void): () => void {
    const listener = (_event: IpcRendererEvent, direction: 'back' | 'forward') => callback(direction);
    ipcRenderer.on('postpile:swipe', listener);
    return () => {
      ipcRenderer.removeListener('postpile:swipe', listener);
    };
  },
  /** Calls back with the tile to open when the user clicks a Mac notification; returns the unsubscribe. */
  onOpenPing(callback: (target: PingTarget) => void): () => void {
    const listener = (_event: IpcRendererEvent, target: PingTarget) => callback(target);
    ipcRenderer.on('postpile:open-ping', listener);
    return () => {
      ipcRenderer.removeListener('postpile:open-ping', listener);
    };
  },
});
