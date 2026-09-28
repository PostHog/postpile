// Runs sandboxed before the renderer. It hands over where the API lives and two
// listeners (trackpad swipes, clicks on Mac notifications), nothing else: no
// node access, no way to send ipc. The main process passes the API values as extra command line arguments,
// which a sandboxed preload can still read.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PingTarget } from '@code-manager/core';

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

contextBridge.exposeInMainWorld('codeManager', {
  apiUrl: argValue('code-manager-api'),
  token: argValue('code-manager-token'),
  /** Calls back with "back" or "forward" on a trackpad swipe; returns the unsubscribe. */
  onSwipe(callback: (direction: 'back' | 'forward') => void): () => void {
    const listener = (_event: IpcRendererEvent, direction: 'back' | 'forward') => callback(direction);
    ipcRenderer.on('code-manager:swipe', listener);
    return () => {
      ipcRenderer.removeListener('code-manager:swipe', listener);
    };
  },
  /** Calls back with the tile to open when the user clicks a Mac notification; returns the unsubscribe. */
  onOpenPing(callback: (target: PingTarget) => void): () => void {
    const listener = (_event: IpcRendererEvent, target: PingTarget) => callback(target);
    ipcRenderer.on('code-manager:open-ping', listener);
    return () => {
      ipcRenderer.removeListener('code-manager:open-ping', listener);
    };
  },
});
