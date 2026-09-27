// Runs sandboxed before the renderer. It hands over where the API lives and one
// listener for trackpad swipes, nothing else: no node access, no way to send
// ipc. The main process passes the API values as extra command line arguments,
// which a sandboxed preload can still read.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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
});
