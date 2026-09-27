// Runs sandboxed before the renderer. It hands over where the API lives and
// nothing else: no ipc, no node access. The main process passes both values as
// extra command line arguments, which a sandboxed preload can still read.
import { contextBridge } from 'electron';

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

contextBridge.exposeInMainWorld('codeManager', {
  apiUrl: argValue('code-manager-api'),
  token: argValue('code-manager-token'),
});
