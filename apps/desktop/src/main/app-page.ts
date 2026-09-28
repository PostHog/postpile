import { fileURLToPath } from 'node:url';

/**
 * The URL is the app's own renderer page: the bundled index.html, or in a
 * dev run the electron-vite dev server (same origin). Query and hash do not
 * matter. Anything else (a page the window was tricked into loading, a
 * frame) is not ours and gets no API token.
 */
export function isAppPage(url: string, rendererFile: string, devUrl: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (devUrl) {
    return parsed.origin === new URL(devUrl).origin;
  }
  return parsed.protocol === 'file:' && fileURLToPath(parsed) === rendererFile;
}

/** Only https links leave the app, to the browser. Everything else is dropped with a reason for the log. */
export function externalLinkProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  return parsed.protocol === 'https:' ? null : `scheme ${parsed.protocol} is not allowed`;
}
