export type BrowserCommand =
  | { kind: 'run' }
  | { kind: 'at-login' }
  | { kind: 'stop' }
  | { kind: 'restart' }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const BROWSER_USAGE = `Usage: postpile browser [--at-login | --stop | --restart]

  postpile browser             Run PostPile for the browser in this terminal (Ctrl-C stops it)
  postpile browser --at-login  Run it in the background now and at every login
  postpile browser --stop      Stop the background one and stop starting it at login
  postpile browser --restart   Restart the background one (after brew upgrade --cask postpile)

Then open http://postpile.localhost:4870`;

const FLAGS: Record<string, BrowserCommand['kind']> = {
  '--at-login': 'at-login',
  '--stop': 'stop',
  '--restart': 'restart',
  '--help': 'help',
  '-h': 'help',
};

export function browserCommand(args: string[]): BrowserCommand {
  if (args.length === 0) {
    return { kind: 'run' };
  }
  const kind = args.length === 1 ? FLAGS[args[0]!] : undefined;
  if (!kind) {
    return { kind: 'error', message: `Unknown arguments: ${args.join(' ')}` };
  }
  return { kind } as BrowserCommand;
}

export function appBundleOf(execPath: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return match ? match[1]! : null;
}

export function browserUrl(port: string | undefined): string {
  return `http://postpile.localhost:${port || '4870'}`;
}
